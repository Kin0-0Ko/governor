import { CostAdapter, CostSignal, ProviderConfig } from '../contracts';
import { computeCostMicros } from '../pricing';

export class BrightDataAdapter implements CostAdapter {
  readonly provider = 'brightdata';

  computeCost(signal: CostSignal, config: ProviderConfig): bigint {
    return computeCostMicros(config.baseRateMicros, signal.features, config.multiplierRules);
  }
}
