export type QuantizeScale = {
  min: number;
  max: number;
  bits: number;
  range: number;
  invSpan: number;
};

export function quantize(value: number, scale: QuantizeScale): number {
  if (!Number.isFinite(value)) return 0;
  const { min, max, range, invSpan } = scale;
  if (max <= min || range <= 0 || !Number.isFinite(invSpan)) return 0;
  const clamped = Math.min(Math.max(value, min), max);
  const normalized = (clamped - min) * invSpan;
  return Math.round(normalized);
}
