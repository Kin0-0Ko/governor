import type { CostAdapter, CostSignal, ProviderConfig } from '../contracts';
import { computeCostMicros } from '../pricing';

export class ScraperApiAdapter implements CostAdapter {
  readonly provider = 'scraperapi';

  computeCost(signal: CostSignal, config: ProviderConfig): bigint {
    return computeCostMicros(
      config.baseRateMicros,
      signal.features,
      config.multiplierRules,
    );
  }
}
