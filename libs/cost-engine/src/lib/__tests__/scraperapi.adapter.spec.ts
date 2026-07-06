import { ScraperApiAdapter } from '../adapters/scraperapi.adapter';
import type { CostSignal, ProviderConfig } from '../contracts';

const makeSignal = (features: string[] = []): CostSignal => ({
  orgId: 'org-1',
  jobId: 'job-1',
  targetId: 'target-1',
  provider: 'scraperapi',
  features,
  idempotencyKey: 'key-001',
  requestTimestamp: '2026-07-06T00:00:00.000Z',
  retryIndex: 0,
});

const CONFIG: ProviderConfig = {
  name: 'scraperapi',
  baseRateMicros: 1_000_000n,
  multiplierRules: [
    { feature: 'jsRender', addend: 5 },
    { feature: 'residential', addend: 3 },
  ],
};

describe('ScraperApiAdapter', () => {
  const adapter = new ScraperApiAdapter();

  it('has correct provider name', () => {
    expect(adapter.provider).toBe('scraperapi');
  });

  it('computes base cost with no features', () => {
    expect(adapter.computeCost(makeSignal([]), CONFIG)).toBe(1_000_000n);
  });

  it('applies 5x jsRender addend (1+5=6x base)', () => {
    expect(adapter.computeCost(makeSignal(['jsRender']), CONFIG)).toBe(6_000_000n);
  });

  it('applies additive multipliers for jsRender + residential (1+5+3=9x)', () => {
    expect(adapter.computeCost(makeSignal(['jsRender', 'residential']), CONFIG)).toBe(9_000_000n);
  });

  it('returns bigint', () => {
    expect(typeof adapter.computeCost(makeSignal(), CONFIG)).toBe('bigint');
  });
});
