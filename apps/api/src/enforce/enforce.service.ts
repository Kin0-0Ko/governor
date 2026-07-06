import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientProxy } from '@nestjs/microservices';
import { BudgetStoreService } from '@governor/budget-store';
import { computeCostMicros } from '@governor/cost-engine';
import { Budget } from '../budgets/entities/budget.entity';
import { Provider } from '../providers/entities/provider.entity';
import { RABBITMQ_CLIENT } from '../messaging/events.module';
import { RABBITMQ_ROUTING_SPEND } from '../messaging/rabbitmq.config';
import { EnforceRequestDto } from './enforce.controller';

export interface EnforceResult {
  decision: 'ALLOWED' | 'DENIED';
  costMicros: bigint;
  remainingMicros: bigint;
  state: string;
  budgetId?: string;
}

@Injectable()
export class EnforceService {
  private readonly logger = new Logger(EnforceService.name);

  constructor(
    @InjectRepository(Budget)
    private readonly budgetRepo: Repository<Budget>,
    @InjectRepository(Provider)
    private readonly providerRepo: Repository<Provider>,
    private readonly budgetStore: BudgetStoreService,
    @Inject(RABBITMQ_CLIENT)
    private readonly rmqClient: ClientProxy,
  ) {}

  async enforce(dto: EnforceRequestDto): Promise<EnforceResult> {
    const budget = await this.budgetRepo.findOne({
      where: { orgId: dto.orgId, jobId: dto.jobId, targetId: dto.targetId },
    });

    if (!budget) {
      this.logger.log({ jobId: dto.jobId, targetId: dto.targetId, orgId: dto.orgId, budgetId: null, costMicros: '0', decision: 'DENIED', state: 'NO_BUDGET', timestamp: new Date().toISOString() });
      return { decision: 'DENIED', costMicros: 0n, remainingMicros: 0n, state: 'NO_BUDGET' };
    }

    const provider = await this.providerRepo.findOne({
      where: { name: dto.provider, active: true },
    });

    const baseRateMicros = provider?.baseRateMicros ?? 1_000_000n;
    const multiplierRules = provider?.multiplierRules ?? [];
    const costMicros = computeCostMicros(baseRateMicros, dto.features, multiplierRules);

    const outcome = await this.budgetStore.evalEnforce({
      orgId: dto.orgId,
      budgetId: budget.id,
      costMicros,
      ttlSeconds: budget.halfOpenTtlSeconds,
    });

    this.logger.log({
      jobId: dto.jobId,
      targetId: dto.targetId,
      orgId: dto.orgId,
      budgetId: budget.id,
      costMicros: costMicros.toString(),
      decision: outcome.allowed ? 'ALLOWED' : 'DENIED',
      state: outcome.state,
      timestamp: new Date().toISOString(),
    });

    if (outcome.allowed) {
      this.rmqClient.emit(RABBITMQ_ROUTING_SPEND, {
        ...dto,
        budgetId: budget.id,
        costMicros: costMicros.toString(),
        baseRateMicros: baseRateMicros.toString(),
        multiplierRules,
        totalCostMicros: costMicros.toString(),
      }).subscribe({ error: (err: unknown) => this.logger.error('RabbitMQ emit failed', err) });

      return {
        decision: 'ALLOWED',
        costMicros,
        remainingMicros: outcome.remainingMicros,
        state: outcome.state,
        budgetId: budget.id,
      };
    }

    return {
      decision: 'DENIED',
      costMicros,
      remainingMicros: outcome.remainingMicros,
      state: outcome.state,
      budgetId: budget.id,
    };
  }
}
