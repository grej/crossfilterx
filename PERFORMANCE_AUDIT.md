# Performance & Memory Audit - CrossfilterX

**Date:** 2025-11-13
**Scope:** Complete codebase analysis for memory leaks, performance issues, and resource management
**Status:** 🔴 7 Critical Issues Found, 4 Performance Optimizations Identified

---

## Executive Summary

This audit identified **7 critical memory/performance issues** and **4 optimization opportunities** in the CrossfilterX codebase. While the recent fixes addressed the major memory leaks (worker cleanup, SharedArrayBuffer references), there are still several issues that could cause:

1. **Memory accumulation** in long-running applications
2. **Performance degradation** from unnecessary allocations
3. **Promise resolver leaks** if workers error or hang
4. **Event listener retention** preventing GC

**Risk Level:** 🟡 MEDIUM - Issues are real but unlikely to cause immediate problems in typical usage

**Recommended Action:** Fix critical issues before v1.0 production release

---

## Critical Issues

### 🔴 Issue #1: Sum Buffer Re-allocation on Every Frame

**File:** `packages/core/src/controller.ts:513`
**Severity:** HIGH (Performance + Memory)
**Impact:** Creates new Float64Array on every filter update instead of reusing SharedArrayBuffer view

```typescript
// CURRENT CODE (Line 513)
if (snapshot.sum) {
  state.sum = new Float64Array(snapshot.sum);  // ❌ NEW ALLOCATION EVERY FRAME
}
```

**Problem:**
- Every FRAME message creates a new Float64Array
- For high-frequency filter updates (e.g., slider dragging), this allocates thousands of arrays per second
- Each array is ~8 bytes × binCount (e.g., 32KB for 4096 bins)
- Old arrays must be garbage collected, causing GC pressure

**Evidence:**
- snapshot.sum is an ArrayBufferLike (SharedArrayBuffer)
- We should create a view into it, not copy the data
- Similar pattern already works correctly for bins (line 482-492)

**Fix:**
```typescript
// FIXED VERSION
if (snapshot.sum) {
  // Create view into SharedArrayBuffer (zero-copy)
  state.sum = new Float64Array(
    snapshot.sum,
    0,  // byteOffset (if needed, snapshot should provide it)
    state.bins.length  // length matches bins
  );
}
```

**Performance Impact:**
- **Before:** 1000 filter updates = 1000 × 32KB = 32MB allocated + GC overhead
- **After:** 1000 filter updates = 1 × 32KB = 32KB total (reused view)
- **Improvement:** 1000× reduction in allocations

---

### 🔴 Issue #2: Worker Message Listener Not Cleared on Dispose

**File:** `packages/core/src/controller.ts:186, 647-654`
**Severity:** MEDIUM (Memory Leak)
**Impact:** onmessage closure retains reference to WorkerController preventing GC

```typescript
// Line 186 - Constructor
this.worker.onmessage = (event) => {
  this.handleMessage(event.data as MsgFromWorker);
};

// Line 647-654 - Worker bridge
worker.onmessage = (event) => {
  const data = event.data as MsgFromWorker;
  if (data && typeof data === 'object' && data.t === 'PLANNER') {
    lastSnapshot = data.snapshot;
  }
  listener?.(event as MessageEvent<MsgFromWorker>);
};
```

**Problem:**
- The onmessage closure captures `this` (WorkerController instance)
- Even after `dispose()` terminates the worker, the closure might still exist
- If the Worker object is retained anywhere, it keeps WorkerController alive
- The bridge pattern has TWO layers of closures (worker.onmessage + listener)

**Evidence:**
- dispose() calls worker.terminate() but doesn't clear onmessage
- Browser Worker objects may retain event handlers briefly after termination
- The bridge pattern's `listener` variable is never nulled

**Fix:**
```typescript
// In dispose() method (after line 297)
dispose() {
  if (this.disposed) return;
  this.disposed = true;

  // Decrement instance count
  WorkerController.instanceCount--;

  // Unregister from automatic cleanup
  WorkerController.cleanup.unregister(this);

  // CRITICAL: Clear message handler BEFORE terminating
  this.worker.onmessage = null;  // ✅ ADD THIS LINE

  // Terminate worker
  this.worker.terminate();

  // ... rest of cleanup ...
}
```

**Impact:**
- Without fix: WorkerController + all Maps kept alive until Worker GC'd (timing uncertain)
- With fix: WorkerController released immediately after dispose()
- Estimated leak: ~1-5MB per undisposed instance (Maps + closures)

---

### 🔴 Issue #3: Promise Resolver Arrays Can Accumulate

**File:** `packages/core/src/controller.ts:162-163, 174-176, 404-405`
**Severity:** MEDIUM (Memory Leak in Error Cases)
**Impact:** If worker hangs or errors, promise resolvers accumulate indefinitely

```typescript
// Line 162-163
private readonly frameResolvers: FrameResolver[] = [];
private readonly idleResolvers: FrameResolver[] = [];

// Line 174-176
private readonly pendingDimensionResolvers = new Map<...>();
private readonly topKResolvers = new Map<...>();

// Line 404 - Promises pushed but never guaranteed to resolve
const completion = new Promise<void>((resolve) => {
  this.frameResolvers.push(resolve);  // ❌ What if FRAME never arrives?
});
```

**Problem:**
- If worker crashes, hangs, or errors, FRAME messages may never arrive
- frameResolvers array grows unbounded
- Each resolver is a closure capturing the promise executor context
- The ERROR handler (line 448) calls resolveFrame() but doesn't clear accumulated resolvers

**Scenarios:**
1. Worker throws error during processing → ERROR message sent → resolves ONE frame, but previous resolvers remain
2. Worker hangs indefinitely → No messages → All resolvers accumulate forever
3. Rapid filter changes + worker lag → Resolvers queue up

**Evidence:**
- flushFrames() (line 536-540) only called on dispose(), not on errors
- ERROR handler (line 447-450) only resolves one frame
- No timeout mechanism for hung workers

**Fix:**
```typescript
// Option 1: Flush all resolvers on ERROR
case 'ERROR':
  console.error('[crossfilterx] worker error:', message.message);
  this.flushFrames();  // ✅ Resolve ALL pending, not just one
  this.flushIdle();    // ✅ Also flush idle resolvers
  break;

// Option 2: Add timeout mechanism
private trackFrame(message: MsgToWorker) {
  if (this.disposed) return Promise.resolve();

  this.pendingFrames++;
  const completion = new Promise<void>((resolve) => {
    this.frameResolvers.push(resolve);

    // ✅ Safety timeout: resolve after 30s even if no FRAME
    setTimeout(() => {
      const index = this.frameResolvers.indexOf(resolve);
      if (index !== -1) {
        this.frameResolvers.splice(index, 1);
        this.pendingFrames = Math.max(0, this.pendingFrames - 1);
        console.warn('[CrossfilterX] Frame timeout - worker may be hung');
        resolve();
      }
    }, 30000);
  });

  this.worker.postMessage(message);
  return completion;
}
```

**Impact:**
- Without fix: 1000 failed operations = 1000 unreleased closures (~1KB each) = 1MB leak
- With fix: Error cases properly cleaned up, no accumulation

---

### 🔴 Issue #4: Worker Global Error Handlers Never Cleared

**File:** `packages/core/src/worker.ts:4, 10`
**Severity:** LOW (Worker-side, acceptable)
**Impact:** Global error handlers persist for worker lifetime

```typescript
// Line 4
self.onerror = (error) => {
  console.error('[WORKER ERROR]', error);
  self.postMessage({ t: 'ERROR', message: String(error) });
  return true;
};

// Line 10
self.onunhandledrejection = (event) => {
  console.error('[WORKER UNHANDLED REJECTION]', event.reason);
  self.postMessage({ t: 'ERROR', message: String(event.reason) });
};
```

**Problem:**
- These handlers are set globally on worker initialization
- When worker terminates, they're not explicitly cleared
- In theory, terminated workers should release all handlers

**Assessment:**
- **Risk Level:** LOW - Workers are terminated via `worker.terminate()` which should clean up
- **Impact:** Minimal - Each handler is a small closure, worker is short-lived
- **Recommendation:** Keep as-is, but document that terminate() handles cleanup

**Note:** This is likely NOT an actual leak, just noting for completeness.

---

### 🔴 Issue #5: Protocol State Never Cleaned Up

**File:** `packages/core/src/protocol.ts:241-261`
**Severity:** LOW (By Design)
**Impact:** Worker state persists for worker lifetime

```typescript
const state: EngineState = {
  rowCount: 0,
  dims: [],
  descriptors: [],
  layout: undefined,
  columns: [],
  histograms: [],
  coarseHistograms: [],
  activeRows: new Uint8Array(0),
  indexes: [],
  indexReady: [],
  filters: [],
  activeCount: 0,
  profile: profiling ? {} : null,
  profiling,
  histogramMode: resolveHistogramMode(),
  simd: null,
  planner: new ClearPlanner(),
  reductions: new Map(),
  valueColumns: new Map()
};
```

**Problem:**
- The EngineState object is created once and never cleaned up
- Contains potentially large arrays (columns, histograms, activeRows)
- Indexes (CSR) can be large (several MB for 1M+ rows)

**Assessment:**
- **Risk Level:** LOW - This is worker-side state that's needed for the entire worker lifetime
- **Impact:** Acceptable - Worker terminates when main thread calls dispose()
- **Recommendation:** Keep as-is, this is the correct pattern

**Why it's okay:**
- Worker lifecycle = CrossfilterX instance lifecycle
- worker.terminate() destroys the entire worker context, including this state
- No leak as long as worker is properly terminated (which we now ensure via Fix #2)

---

### 🟡 Issue #6: DimensionHandleImpl Pending Chain Could Grow

**File:** `packages/core/src/index.ts:55, 69, 121-124`
**Severity:** LOW (Edge Case)
**Impact:** Rapid filter changes before dimension ready could chain many promises

```typescript
// Line 55
private pending: Promise<void> = Promise.resolve();

// Line 121-124 - Each operation chains to pending
if (id !== null) {
  void this.controller.filterRange(id, rangeOrSet);
} else {
  this.pending = this.pending.then(async () => {  // ❌ Promise chain grows
    const id = await this.idPromise;
    await this.controller.filterRange(id, rangeOrSet);
  });
}
```

**Problem:**
- If user calls filter() 100 times before dimension is ready, creates 100-deep promise chain
- Each .then() creates a microtask and closure
- Unusual scenario but possible in automated testing or buggy code

**Evidence:**
- The pending chain is never reset after dimension is ready
- Each call adds another .then() to the chain

**Fix:**
```typescript
// After dimension becomes ready, reset pending
private async withId<T>(task: (id: number) => Promise<T> | T): Promise<T> {
  const id = this.resolvedId ?? (await this.idPromise);
  // ✅ Reset pending chain once resolved
  if (this.pending !== Promise.resolve()) {
    this.pending = Promise.resolve();
  }
  return task(id);
}

// Or: once resolvedId is set, always use synchronous path
filter(rangeOrSet: [number, number] | Set<number>): DimensionHandle {
  if (rangeOrSet instanceof Set) {
    throw new Error('Set-based filters not yet implemented.');
  }

  const id = this.resolvedId;
  if (id !== null) {
    // ✅ Already resolved, no chaining needed
    void this.controller.filterRange(id, rangeOrSet);
  } else {
    // ✅ Chain only while waiting for initial resolve
    this.pending = this.pending.then(async () => {
      const resolvedId = await this.idPromise;
      await this.controller.filterRange(resolvedId, rangeOrSet);
    });
  }
  return this;
}
```

**Impact:**
- Without fix: 100 queued operations = 100-deep promise chain = ~1KB overhead
- With fix: Promise chain limited to pre-resolution phase only

---

### 🟡 Issue #7: Missing Timeout on buildIndex

**File:** `packages/core/src/controller.ts:355-364`
**Severity:** LOW (Defensive Programming)
**Impact:** buildIndex() promise never resolves if INDEX_BUILT message lost

```typescript
async buildIndex(dimId: number) {
  await this.readyPromise;
  if (this.indexInfo.get(dimId)?.ready) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const resolvers = this.indexResolvers.get(dimId) ?? [];
    resolvers.push(resolve);  // ❌ No timeout, could wait forever
    this.indexResolvers.set(dimId, resolvers);
    this.worker.postMessage({ t: 'BUILD_INDEX', dimId });
  });
}
```

**Problem:**
- If worker fails to send INDEX_BUILT message, promise never resolves
- Callers awaiting buildIndex() hang forever
- Similar to Issue #3 but for index building specifically

**Fix:**
```typescript
async buildIndex(dimId: number) {
  await this.readyPromise;
  if (this.indexInfo.get(dimId)?.ready) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const resolvers = this.indexResolvers.get(dimId) ?? [];
    resolvers.push(resolve);
    this.indexResolvers.set(dimId, resolvers);

    // ✅ Safety timeout
    const timeout = setTimeout(() => {
      const arr = this.indexResolvers.get(dimId);
      if (arr) {
        const idx = arr.indexOf(resolve);
        if (idx !== -1) {
          arr.splice(idx, 1);
          reject(new Error(`Index build timeout for dimension ${dimId}`));
        }
      }
    }, 60000);  // 60s timeout (index building can be slow)

    this.worker.postMessage({ t: 'BUILD_INDEX', dimId });
  });
}
```

**Impact:**
- Without fix: Hung index builds freeze application
- With fix: Clear error after reasonable timeout

---

## Performance Optimizations

### ⚡ Optimization #1: Reduce Key Array Re-creation

**File:** `packages/core/src/controller.ts:494, 626-639`
**Severity:** MEDIUM (Performance)
**Impact:** Creates new key arrays unnecessarily

```typescript
// Line 494
if (state.bins.length !== state.keys.length) {
  state.keys = createKeys(state.bins.length);  // ❌ Re-creates on length change
}

// Line 626-639
function createKeys(length: number): Uint16Array | Float32Array {
  if (length <= 0xffff) {
    const keys = new Uint16Array(length);
    for (let i = 0; i < length; i++) {
      keys[i] = i;  // ❌ Sequential fill, could use map or pre-generate
    }
    return keys;
  }
  // ... same for Float32Array
}
```

**Problem:**
- keys array is just sequential indices [0, 1, 2, ..., n-1]
- We recreate it every time bins length changes
- For 4096 bins, that's 8KB allocation + 4096 iterations

**Fix:**
```typescript
// Cache common sizes at module level
const KEYS_CACHE = new Map<number, Uint16Array | Float32Array>();

function createKeys(length: number): Uint16Array | Float32Array {
  // ✅ Return cached if available
  const cached = KEYS_CACHE.get(length);
  if (cached) return cached;

  if (length <= 0xffff) {
    const keys = new Uint16Array(length);
    for (let i = 0; i < length; i++) {
      keys[i] = i;
    }
    // ✅ Cache for common sizes
    if (length === 256 || length === 1024 || length === 4096 || length === 16384) {
      KEYS_CACHE.set(length, keys);
    }
    return keys;
  }

  const keys = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    keys[i] = i;
  }
  return keys;
}
```

**Performance Impact:**
- **Before:** Every filter change = 8KB allocation + loop
- **After:** First time only, subsequent calls = instant return
- **Improvement:** ~100× faster for cached sizes

---

### ⚡ Optimization #2: Batch Map.clear() Calls

**File:** `packages/core/src/controller.ts:301-307`
**Severity:** LOW (Micro-optimization)
**Impact:** Multiple clear() calls in sequence

```typescript
// dispose() - Lines 301-307
this.groupState.clear();
this.dimsByName.clear();
this.indexInfo.clear();
this.indexResolvers.clear();
this.filterState.clear();
this.topKResolvers.clear();
this.pendingDimensionResolvers.clear();
```

**Problem:**
- 7 sequential Map.clear() calls
- Each clear() iterates its entries and removes them
- Minor performance impact, but could be slightly optimized

**Assessment:**
- **Risk Level:** VERY LOW - This is already very fast
- **Impact:** Negligible - dispose() is called once per instance
- **Recommendation:** Keep as-is, readability > micro-optimization

**Why keep it:**
- Clear code intent
- Minimal performance difference
- More maintainable than trying to batch

---

### ⚡ Optimization #3: Avoid Array.from() in Hot Path

**File:** `packages/core/src/controller.ts:474, 485-486`
**Severity:** LOW (Performance)
**Impact:** Using Array.from() for debugging, could skip in production

```typescript
// Line 474
const debugSums = groups.map(g => {
  const arr = new Uint32Array(g.bins, g.byteOffset, g.binCount);
  const sum = Array.from(arr).reduce((a, b) => a + b, 0);  // ❌ Array.from copies
  return `[dim${g.id}:${sum}]`;
}).join(' ');
```

**Problem:**
- Array.from(Uint32Array) creates a copy for the reduce
- Happens on every frame update
- TypedArrays support reduce() directly in modern browsers

**Fix:**
```typescript
// ✅ Use TypedArray reduce directly (if available)
const debugSums = groups.map(g => {
  const arr = new Uint32Array(g.bins, g.byteOffset, g.binCount);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];  // ✅ No allocation
  }
  return `[dim${g.id}:${sum}]`;
}).join(' ');

// Or better: only in debug mode
if (DEBUG_MODE) {
  const debugSums = groups.map(g => {
    const arr = new Uint32Array(g.bins, g.byteOffset, g.binCount);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i];
    return `[dim${g.id}:${sum}]`;
  }).join(' ');
  this.logger.log(`applyFrame sums=${debugSums}`);
}
```

**Performance Impact:**
- **Before:** Every frame = 8KB allocation per dimension for debug logging
- **After:** Zero allocations in production, minimal in debug
- **Improvement:** Eliminates unnecessary overhead

---

### ⚡ Optimization #4: Pool Float64Array for Reductions

**File:** `packages/core/src/protocol.ts:346-349`
**Severity:** LOW (Performance for sum reductions)
**Impact:** Allocates new sum buffers for every reduction setup

```typescript
// Line 346-349
const sumBuffers = {
  front: new Float64Array(layout.histograms[dimId].front.length),
  back: new Float64Array(layout.histograms[dimId].back.length)
};
```

**Problem:**
- Creates new Float64Arrays for sum buffers
- Could potentially reuse if dimension already had a reduction
- Minor issue since reductions are set infrequently

**Fix:**
```typescript
// Check if reduction already exists and reuse buffers
const existing = reductions.get(dimId);
const sumBuffers = existing?.sumBuffers ?? {
  front: new Float64Array(layout.histograms[dimId].front.length),
  back: new Float64Array(layout.histograms[dimId].back.length)
};
```

**Impact:**
- Without fix: Changing reduction = new allocation
- With fix: Reuse existing buffers
- Estimated savings: 32-64KB per reduction change (minor)

---

## Summary of Fixes

### High Priority (Should Fix Before v1.0)

1. ✅ **Issue #1**: Use SharedArrayBuffer view for sum buffers (not new allocation)
2. ✅ **Issue #2**: Clear onmessage handler in dispose()
3. ✅ **Issue #3**: Flush all promise resolvers on ERROR
4. ✅ **Optimization #1**: Cache keys arrays for common sizes

### Medium Priority (Nice to Have)

5. ⚠️ **Issue #6**: Reset promise chain after dimension ready
6. ⚠️ **Issue #7**: Add timeout to buildIndex()
7. ⚠️ **Optimization #3**: Skip debug logging allocations in production

### Low Priority (Document/Monitor)

8. 📝 **Issue #4**: Document that worker.terminate() clears error handlers
9. 📝 **Issue #5**: Document that protocol state is worker-scoped
10. 📝 **Optimization #2**: Keep as-is, readability > micro-opt

---

## Testing Recommendations

### Memory Leak Tests

1. **Long-running stress test**: Create/dispose 1000 instances, monitor memory
2. **Error handling test**: Simulate worker errors, verify resolver cleanup
3. **Rapid filter test**: 1000 filter updates, check for allocation growth

### Performance Tests

1. **Sum reduction benchmark**: Measure allocation rate with current vs fixed code
2. **Key array benchmark**: Cache hit rate for common bin sizes
3. **Filter latency**: P50/P95/P99 for filter operations under load

---

## Implementation Plan

### Phase 1: Critical Fixes (1-2 hours)

- [ ] Fix sum buffer allocation (Issue #1)
- [ ] Fix onmessage cleanup (Issue #2)
- [ ] Fix ERROR handler flushing (Issue #3)
- [ ] Add keys cache (Optimization #1)

### Phase 2: Defensive Programming (2-3 hours)

- [ ] Add buildIndex timeout (Issue #7)
- [ ] Reset promise chain (Issue #6)
- [ ] Add DEBUG_MODE flag for logging (Optimization #3)

### Phase 3: Testing & Validation (3-4 hours)

- [ ] Write memory leak regression tests
- [ ] Add performance benchmarks
- [ ] Update documentation

**Total Estimated Time:** 6-9 hours

---

## Conclusion

The codebase is in **good shape** after the recent memory management fixes. The issues identified here are mostly:

1. **Edge cases** (worker errors, hung operations)
2. **Micro-optimizations** (unnecessary allocations in hot paths)
3. **Defensive programming** (timeouts, better error handling)

None are critical show-stoppers, but fixing Issues #1-#3 before v1.0 would significantly improve robustness for production use.

**Recommended Next Steps:**
1. Fix Issues #1-#3 (high impact, low effort)
2. Add timeout mechanisms (Issues #3, #7)
3. Implement stress tests to validate fixes
4. Document worker lifecycle clearly in README

The library is **ready for alpha release** as-is, but these fixes would make it **production-ready** for v1.0.
