import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientProxy } from '@nestjs/microservices';
import { BudgetStoreService } from '@governor/budget-store';
import { computeCostMicros } from '@governor/cost-engine';
import { Budget } from '../budgets/entities/budget.entity';
import { Provider } from '../providers/entities/provider.entity';
import { RABBITMQ_CLIENT } from '../messaging/events.module';
import { RABBITMQ_ROUTING_SPEND, RABBITMQ_ROUTING_ALERT } from '../messaging/rabbitmq.config';
import { EnforceRequestDto } from './enforce.controller';
import { StreamService } from '../stream/stream.service';
import { OutboxService } from '../outbox/outbox.service';

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
    private readonly streamService: StreamService,
    private readonly outboxService: OutboxService,
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

    if (!provider) {
      this.logger.log({ jobId: dto.jobId, targetId: dto.targetId, orgId: dto.orgId, budgetId: budget.id, costMicros: '0', decision: 'DENIED', state: 'UNKNOWN_PROVIDER', timestamp: new Date().toISOString() });
      return { decision: 'DENIED', costMicros: 0n, remainingMicros: 0n, state: 'UNKNOWN_PROVIDER', budgetId: budget.id };
    }

    const baseRateMicros = provider.baseRateMicros;
    const multiplierRules = provider.multiplierRules;
    const costMicros = computeCostMicros(baseRateMicros, dto.features, multiplierRules);

    let outcome = await this.budgetStore.evalEnforce({
      orgId: dto.orgId,
      budgetId: budget.id,
      costMicros,
      ttlSeconds: budget.halfOpenTtlSeconds,
    });

    if (outcome.state === 'NO_BUDGET') {
      // Live enforcement state was lost (e.g. Redis cache eviction) but the budget
      // still exists durably — re-warm the cap and retry once before treating it
      // as truly nonexistent (FR-006).
      await this.budgetStore.warmCapKey(dto.orgId, budget.id, budget.capMicros);
      outcome = await this.budgetStore.evalEnforce({
        orgId: dto.orgId,
        budgetId: budget.id,
        costMicros,
        ttlSeconds: budget.halfOpenTtlSeconds,
      });
    }

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

    if (outcome.state === 'TRIPPED' || outcome.state === 'OPEN') {
      // Constitution Principle VI: breach alert MUST be published before DENY is returned.
      await this.emitAlert(RABBITMQ_ROUTING_ALERT, {
        budgetId: budget.id,
        orgId: dto.orgId,
        eventType: 'CIRCUIT_TRIPPED',
        spendAtEventMicros: outcome.spendMicros.toString(),
        capMicros: budget.capMicros.toString(),
      });
      this.streamService.emit(budget.id, {
        type: 'state_change',
        data: {
          previousState: 'CLOSED',
          newState: outcome.state,
          ts: new Date().toISOString(),
          budgetId: budget.id,
        },
      });
    }

    if (outcome.allowed) {
      this.rmqClient.emit(RABBITMQ_ROUTING_SPEND, {
        ...dto,
        budgetId: budget.id,
        costMicros: costMicros.toString(),
        baseRateMicros: baseRateMicros.toString(),
        multiplierRules,
        totalCostMicros: costMicros.toString(),
      }).subscribe({ error: (err: unknown) => this.logger.error('RabbitMQ emit failed', err) });

      this.streamService.emit(budget.id, {
        type: 'spend',
        data: {
          spendMicros: outcome.spendMicros.toString(),
          remainingMicros: outcome.remainingMicros.toString(),
          state: outcome.state,
          ts: new Date().toISOString(),
        },
      });

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

  private async emitAlert(routingKey: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        this.rmqClient.emit(routingKey, payload).subscribe({
          next: () => resolve(),
          error: (err: unknown) => reject(err),
        });
      });
    } catch (err) {
      this.logger.error(`Alert emit failed for ${routingKey}, recording to outbox`, err as Error);
      await this.outboxService.recordFallback(routingKey, payload);
    }
  }
}
