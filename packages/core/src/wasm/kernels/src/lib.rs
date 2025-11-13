//! CrossfilterX WebAssembly kernels.
//!
//! This crate exposes small SIMD-friendly helpers that operate on data passed
//! from the JavaScript runtime. The initial implementation provides a
//! histogram accumulator that groups bin indices and returns per-bin counts. It
//! mirrors the interface the TypeScript layer expects, so we can swap in a
//! future SIMD-enabled version without touching the higher-level plumbing.

use std::cell::RefCell;
use wasm_bindgen::prelude::*;

#[cfg(target_feature = "simd128")]
use std::arch::wasm32::{u16x8_extract_lane, v128_load};

thread_local! {
    static SCRATCH: RefCell<Vec<u16>> = RefCell::new(Vec::new());
    static METRICS: RefCell<Metrics> = RefCell::new(Metrics::default());
}

/// Initialise panic hook so Rust panics surface as readable messages in the
/// browser/devtools console rather than silently trapping.
#[wasm_bindgen]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

/// Computes per-bin counts for the provided bin index stream.
///
/// * `bins` – A dense list of bin identifiers corresponding to each row being
///   toggled (activation or deactivation). The JavaScript caller is responsible
///   for extracting the bin indices from SharedArrayBuffer data before invoking
///   this function.
/// * `bin_count` – Total number of bins for the target dimension. The function
///   returns a typed array with this exact length so the caller can apply the
///   deltas directly onto the front/back histogram buffers.
///
/// The returned `Uint32Array` owns its data inside the WebAssembly linear
/// memory. JavaScript can read it immediately (e.g. via `new Uint32Array(result)`)
/// and then drop the reference; the next invocation reuses the allocation on the
/// Rust side.
#[wasm_bindgen(js_name = scratchBuffer)]
pub fn scratch_buffer(size: u32) -> js_sys::Uint16Array {
    SCRATCH.with(|cell| {
        let mut scratch = cell.borrow_mut();
        let size = size as usize;
        if scratch.len() < size {
            scratch.resize(size, 0);
        }
        unsafe { js_sys::Uint16Array::view(&scratch[..size]) }
    })
}

#[wasm_bindgen(js_name = accumulateScratch)]
pub fn accumulate_scratch(len: u32, bin_count: u32) -> Result<js_sys::Uint32Array, JsValue> {
    SCRATCH.with(|cell| {
        let scratch = cell.borrow();
        let len = len as usize;
        if len > scratch.len() {
            return Err(JsValue::from_str("scratch length exceeded"));
        }
        accumulate_slice(&scratch[..len], bin_count)
    })
}

#[wasm_bindgen(js_name = accumulateBins)]
pub fn accumulate_bins(
    bins: &js_sys::Uint16Array,
    bin_count: u32,
) -> Result<js_sys::Uint32Array, JsValue> {
    let data = bins.to_vec();
    accumulate_slice(&data, bin_count)
}

fn accumulate_slice(data: &[u16], bin_count: u32) -> Result<js_sys::Uint32Array, JsValue> {
    let bin_count = bin_count as usize;
    if bin_count == 0 {
        return Err(JsValue::from_str("bin_count must be greater than zero"));
    }

    let mut counts = vec![0u32; bin_count];

    METRICS.with(|metrics| metrics.borrow_mut().reset());

    #[cfg(target_feature = "simd128")]
    {
        accumulate_simd(data, &mut counts);
    }

    #[cfg(not(target_feature = "simd128"))]
    {
        accumulate_scalar(data, &mut counts);
    }

    METRICS.with(|metrics| metrics.borrow_mut().finalise());

    Ok(js_sys::Uint32Array::from(counts.as_slice()))
}

#[cfg(target_feature = "simd128")]
fn accumulate_simd(data: &[u16], counts: &mut [u32]) {
    let (shard_bits, shard_size) = shard_params(counts.len());
    let shard_slots = shard_slot_count(counts.len());
    let mut cache = ShardCache::new(shard_bits, shard_size, shard_slots);
    let mut index = 0;
    const LANES: usize = 8;

    unsafe {
        while index + LANES <= data.len() {
            let lane = v128_load(data.as_ptr().add(index) as *const _);
            for i in 0..LANES {
                cache.increment(u16x8_extract_lane(lane, i as u8) as usize, counts);
            }
            index += LANES;
        }
    }

    for &bin in &data[index..] {
        cache.increment(bin as usize, counts);
    }

    cache.flush_all(counts);
}

#[cfg(target_feature = "simd128")]
#[allow(dead_code)]
fn accumulate_scalar(data: &[u16], counts: &mut [u32]) {
    accumulate_scalar_common(data, counts);
}

#[cfg(not(target_feature = "simd128"))]
fn accumulate_scalar(data: &[u16], counts: &mut [u32]) {
    accumulate_scalar_common(data, counts);
}

fn accumulate_scalar_common(data: &[u16], counts: &mut [u32]) {
    let (shard_bits, shard_size) = shard_params(counts.len());
    let shard_slots = shard_slot_count(counts.len());
    let mut cache = ShardCache::new(shard_bits, shard_size, shard_slots);
    for &bin in data {
        cache.increment(bin as usize, counts);
    }
    cache.flush_all(counts);
}

fn shard_params(len: usize) -> (usize, usize) {
    match len {
        n if n <= 256 => (0, n.max(1)),
        n if n <= 2048 => (6, 64),
        n if n <= 16384 => (8, 256),
        _ => (10, 512),
    }
}

/// Heuristic determining how many shard buffers to keep hot at once based on
/// the total number of bins. Wider histograms benefit from additional shards so
/// we can accumulate several disjoint regions before flushing to the backing
/// array, while narrow ones keep a single shard to minimise bookkeeping.
fn shard_slot_count(len: usize) -> usize {
    let (shard_bits, _) = shard_params(len);
    let shard_count = if shard_bits == 0 {
        1
    } else {
        len.saturating_sub(1) >> shard_bits
    } + 1;
    let cap = match len {
        n if n <= 2048 => 8,
        n if n <= 16384 => 16,
        _ => 32,
    };
    shard_count.min(cap).max(1)
}

/// Small cache that groups histogram writes into shard-local buffers. Each slot
/// tracks one high-order shard of the histogram and accumulates its counts in a
/// contiguous slice so we only touch the backing array when the shard rotates
/// out of the cache.
#[derive(Clone)]
struct ShardSlot {
    id: Option<usize>,
    used: bool,
}

struct ShardCache {
    shard_bits: usize,
    shard_size: usize,
    slots: Vec<ShardSlot>,
    shard_map: Vec<u8>,
    store: Vec<u32>,
    next_evict: usize,
    mask: usize,
}

impl ShardCache {
    fn new(shard_bits: usize, shard_size: usize, slot_count: usize) -> Self {
        let slot_count = slot_count.max(1);
        let mask = if shard_bits == 0 {
            usize::MAX
        } else {
            (1usize << shard_bits) - 1
        };
        let shard_map_size = if shard_bits == 0 { 1 } else { 1 << (16 - shard_bits) };
        ShardCache {
            shard_bits,
            shard_size,
            slots: vec![
                ShardSlot {
                    id: None,
                    used: false
                };
                slot_count
            ],
            shard_map: vec![0; shard_map_size],
            store: vec![0u32; shard_size * slot_count],
            next_evict: 0,
            mask,
        }
    }

    fn increment(&mut self, bin: usize, counts: &mut [u32]) {
        if bin >= counts.len() {
            return;
        }
        let shard_idx = if self.shard_bits == 0 {
            0
        } else {
            bin >> self.shard_bits
        };
        let slot_index = self.ensure_slot(shard_idx, counts);
        let local_index = if self.shard_bits == 0 {
            bin
        } else {
            bin & self.mask
        };
        if local_index < self.shard_size {
            let base = slot_index * self.shard_size + local_index;
            self.store[base] += 1;
            self.slots[slot_index].used = true;
        } else if let Some(target) = counts.get_mut(bin) {
            *target += 1;
        }
    }

    fn ensure_slot(&mut self, shard_idx: usize, counts: &mut [u32]) -> usize {
        if shard_idx < self.shard_map.len() {
            let slot_plus_one = self.shard_map[shard_idx];
            if slot_plus_one > 0 {
                return (slot_plus_one - 1) as usize;
            }
        }

        if let Some(slot_index) = self.slots.iter().position(|slot| slot.id.is_none()) {
            self.reset_slot_counts(slot_index);
            let slot = &mut self.slots[slot_index];
            slot.id = Some(shard_idx);
            slot.used = false;
            if shard_idx < self.shard_map.len() {
                self.shard_map[shard_idx] = (slot_index + 1) as u8;
            }
            return slot_index;
        }

        let slot_index = self.next_evict % self.slots.len();
        self.flush_slot(slot_index, counts, FlushReason::Evict);
        self.reset_slot_counts(slot_index);
        if let Some(old_shard_idx) = self.slots[slot_index].id {
            if old_shard_idx < self.shard_map.len() {
                self.shard_map[old_shard_idx] = 0;
            }
        }
        self.slots[slot_index].id = Some(shard_idx);
        self.slots[slot_index].used = false;
        if shard_idx < self.shard_map.len() {
            self.shard_map[shard_idx] = (slot_index + 1) as u8;
        }
        self.next_evict = (slot_index + 1) % self.slots.len();
        slot_index
    }

    fn flush_slot(&mut self, slot_index: usize, counts: &mut [u32], reason: FlushReason) {
        if self.slots.is_empty() {
            return;
        }
        let Some(shard_idx) = self.slots[slot_index].id else {
            return;
        };
        if !self.slots[slot_index].used {
            return;
        }
        let base_idx = shard_idx << self.shard_bits;
        let mut bins_written = 0u32;
        let mut rows_written = 0u64;
        let start = slot_index * self.shard_size;
        let end = start + self.shard_size;
        for (offset, value) in self.store[start..end].iter_mut().enumerate() {
            if *value == 0 {
                continue;
            }
            let idx = base_idx + offset;
            if let Some(target) = counts.get_mut(idx) {
                *target += *value;
                rows_written += u64::from(*value);
            }
            *value = 0;
            bins_written += 1;
        }
        self.slots[slot_index].used = false;

        if bins_written > 0 {
            METRICS.with(|metrics| {
                let mut metrics = metrics.borrow_mut();
                metrics.flushes += 1;
                metrics.bins += u64::from(bins_written);
                metrics.rows += rows_written;
                match reason {
                    FlushReason::Evict => metrics.evicts += 1,
                    FlushReason::Final => metrics.final_flushes += 1,
                }
            });
        }
    }

    fn reset_slot_counts(&mut self, slot_index: usize) {
        let start = slot_index * self.shard_size;
        let end = start + self.shard_size;
        for value in &mut self.store[start..end] {
            *value = 0;
        }
    }

    fn flush_all(&mut self, counts: &mut [u32]) {
        for slot_index in 0..self.slots.len() {
            self.flush_slot(slot_index, counts, FlushReason::Final);
            self.slots[slot_index].id = None;
            self.slots[slot_index].used = false;
        }
        for i in 0..self.shard_map.len() {
            self.shard_map[i] = 0;
        }
    }
}

enum FlushReason {
    Evict,
    Final,
}

#[derive(Default)]
struct Metrics {
    flushes: u64,
    evicts: u64,
    final_flushes: u64,
    bins: u64,
    rows: u64,
}

impl Metrics {
    fn reset(&mut self) {
        *self = Metrics::default();
    }

    fn finalise(&mut self) {
        // no-op placeholder for future derived fields
    }
}

#[wasm_bindgen(js_name = resetMetrics)]
pub fn reset_metrics() {
    METRICS.with(|metrics| metrics.borrow_mut().reset());
}

#[wasm_bindgen(js_name = takeMetrics)]
pub fn take_metrics() -> JsValue {
    use js_sys::Object;
    use js_sys::Reflect;
    use wasm_bindgen::JsValue;

    METRICS.with(|metrics| {
        let mut metrics = metrics.borrow_mut();
        let result = Object::new();
        let _ = Reflect::set(
            &result,
            &JsValue::from_str("flushes"),
            &JsValue::from_f64(metrics.flushes as f64),
        );
        let _ = Reflect::set(
            &result,
            &JsValue::from_str("evictions"),
            &JsValue::from_f64(metrics.evicts as f64),
        );
        let _ = Reflect::set(
            &result,
            &JsValue::from_str("finalFlushes"),
            &JsValue::from_f64(metrics.final_flushes as f64),
        );
        let _ = Reflect::set(
            &result,
            &JsValue::from_str("bins"),
            &JsValue::from_f64(metrics.bins as f64),
        );
        let _ = Reflect::set(
            &result,
            &JsValue::from_str("rows"),
            &JsValue::from_f64(metrics.rows as f64),
        );
        metrics.reset();
        JsValue::from(result)
    })
}
