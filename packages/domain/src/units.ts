/**
 * Units are millimetres everywhere. Stored values are never rounded;
 * rounding only happens for display (default 0.5 mm) and input (0.1 mm).
 */
export type Mm = number;

export const MM_PER_INCH = 25.4;

export function roundTo(value: number, step: number): number {
  if (!Number.isFinite(value) || step <= 0) return value;
  return Math.round(value / step) * step;
}

/** Display formatting: 0.5 mm by default, trailing ".0" removed. */
export function fmtMm(value: number | null | undefined, step = 0.5): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const r = roundTo(value, step);
  const decimals = step >= 1 ? 0 : step >= 0.5 ? 1 : 2;
  return r.toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

/** Parse typed input to 0.1 mm precision; returns null when not a number. */
export function parseMmInput(raw: string, step = 0.1): number | null {
  const t = raw.trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return roundTo(Number(t), step);
}

export function inchToMm(inch: number): Mm {
  return inch * MM_PER_INCH;
}
