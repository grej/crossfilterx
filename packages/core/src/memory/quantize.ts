export type QuantizeScale = {
  min: number;
  max: number;
  bits: number;
};

export function quantize(value: number, scale: QuantizeScale): number {
  if (!Number.isFinite(value)) return 0;
  const { min, max, bits } = scale;
  if (max <= min) return 0;
  const range = (1 << bits) - 1;
  const clamped = Math.min(Math.max(value, min), max);
  const normalized = (clamped - min) / (max - min);
  return Math.round(normalized * range);
}
