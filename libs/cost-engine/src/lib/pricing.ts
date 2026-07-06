import type { MultiplierRule } from './contracts';

/**
 * Computes total request cost in micro-dollars using additive multiplier model.
 *
 * Addend values are safe integers summed as `number` first, then converted to
 * BigInt exactly once before multiplication — no intermediate float, no per-step
 * BigInt coercion. Constitution Principle II compliance.
 */
export function computeCostMicros(
  baseRateMicros: bigint,
  activeFeatures: string[],
  multiplierRules: MultiplierRule[],
): bigint {
  const activeSet = new Set(activeFeatures);
  const totalMultiplier = multiplierRules.reduce(
    (acc, rule) => (activeSet.has(rule.feature) ? acc + rule.addend : acc),
    1, // base multiplier
  );
  return baseRateMicros * BigInt(totalMultiplier);
}
