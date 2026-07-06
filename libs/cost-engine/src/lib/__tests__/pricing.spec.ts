import { computeCostMicros } from '../pricing';
import type { MultiplierRule } from '../contracts';

const BASE_RATE = 1_000_000n; // $1.00

const RULES: MultiplierRule[] = [
  { feature: 'jsRender', addend: 5 },
  { feature: 'residential', addend: 3 },
];

describe('computeCostMicros', () => {
  it('returns base rate when no features active', () => {
    expect(computeCostMicros(BASE_RATE, [], RULES)).toBe(1_000_000n);
  });

  it('applies single multiplier additively (jsRender: 1+5=6x)', () => {
    expect(computeCostMicros(BASE_RATE, ['jsRender'], RULES)).toBe(6_000_000n);
  });

  it('applies single multiplier additively (residential: 1+3=4x)', () => {
    expect(computeCostMicros(BASE_RATE, ['residential'], RULES)).toBe(4_000_000n);
  });

  it('sums addends for multiple active features (jsRender+residential: 1+5+3=9x)', () => {
    expect(computeCostMicros(BASE_RATE, ['jsRender', 'residential'], RULES)).toBe(9_000_000n);
  });

  it('ignores unknown features not in rules', () => {
    expect(computeCostMicros(BASE_RATE, ['unknownFeature'], RULES)).toBe(1_000_000n);
  });

  it('returns bigint type', () => {
    expect(typeof computeCostMicros(BASE_RATE, [], RULES)).toBe('bigint');
  });

  it('handles zero base rate', () => {
    expect(computeCostMicros(0n, ['jsRender'], RULES)).toBe(0n);
  });

  it('handles empty rules (no multipliers available)', () => {
    expect(computeCostMicros(BASE_RATE, ['jsRender'], [])).toBe(1_000_000n);
  });

  it('handles large micro-dollar values without precision loss', () => {
    const largeCap = 999_999_999_999_999n;
    const result = computeCostMicros(largeCap, [], []);
    expect(result).toBe(largeCap);
  });
});
