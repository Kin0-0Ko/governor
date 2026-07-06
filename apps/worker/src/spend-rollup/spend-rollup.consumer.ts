import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SpendEvent, SpendDecision } from '../entities/spend-event.entity';

const SPEND_RECORDED = 'spend.recorded';

interface SpendRecordedPayload {
  orgId: string;
  jobId: string;
  targetId: string;
  provider: string;
  features: string[];
  idempotencyKey: string;
  requestTimestamp: string;
  budgetId: string;
  baseRateMicros: string;
  totalCostMicros: string;
  multiplierRules: Array<{ feature: string; addend: number }>;
}

@Controller()
export class SpendRollupConsumer {
  private readonly logger = new Logger(SpendRollupConsumer.name);

  constructor(
    @InjectRepository(SpendEvent)
    private readonly spendRepo: Repository<SpendEvent>,
  ) {}

  @EventPattern(SPEND_RECORDED)
  async handleSpendRecorded(
    @Payload() data: SpendRecordedPayload,
    @Ctx() ctx: RmqContext,
  ): Promise<void> {
    const channel = ctx.getChannelRef();
    const message = ctx.getMessage();

    try {
      const multiplierSum = data.multiplierRules
        .filter((r) => data.features.includes(r.feature))
        .reduce((acc, r) => acc + r.addend, 1);

      const event = this.spendRepo.create({
        idempotencyKey: data.idempotencyKey,
        orgId: data.orgId,
        jobId: data.jobId,
        targetId: data.targetId,
        budgetId: data.budgetId,
        provider: data.provider,
        baseRateMicros: BigInt(data.baseRateMicros),
        totalCostMicros: BigInt(data.totalCostMicros),
        multiplierSum,
        features: data.features,
        decision: SpendDecision.ALLOWED,
        requestTimestamp: new Date(data.requestTimestamp),
      });

      await this.spendRepo.save(event);
      channel.ack(message);
      this.logger.log(`Spend recorded: ${data.idempotencyKey}`);
    } catch (err: unknown) {
      const isDuplicate =
        err instanceof Error && err.message.includes('duplicate key');

      if (isDuplicate) {
        this.logger.log(`Idempotent duplicate: ${data.idempotencyKey}`);
        channel.ack(message);
        return;
      }

      this.logger.error('Failed to persist spend event', err);
      channel.nack(message, false, false);
    }
  }
}
