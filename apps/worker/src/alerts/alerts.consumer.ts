import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AlertEvent, AlertEventType } from '../entities/alert-event.entity';

const BUDGET_BREACHED = 'budget.breached';

interface BudgetBreachedPayload {
  budgetId: string;
  orgId: string;
  eventType: AlertEventType;
  spendAtEventMicros: string;
  capMicros: string;
}

@Controller()
export class AlertsConsumer {
  private readonly logger = new Logger(AlertsConsumer.name);

  constructor(
    @InjectRepository(AlertEvent)
    private readonly alertRepo: Repository<AlertEvent>,
  ) {}

  @EventPattern(BUDGET_BREACHED)
  async handleBudgetBreached(
    @Payload() data: BudgetBreachedPayload,
    @Ctx() ctx: RmqContext,
  ): Promise<void> {
    const channel = ctx.getChannelRef();
    const message = ctx.getMessage();

    try {
      const event = this.alertRepo.create({
        budgetId: data.budgetId,
        orgId: data.orgId,
        eventType: data.eventType ?? AlertEventType.BUDGET_BREACHED,
        spendAtEventMicros: BigInt(data.spendAtEventMicros),
        capMicros: BigInt(data.capMicros),
      });

      await this.alertRepo.save(event);
      channel.ack(message);

      this.logger.log(
        `Alert recorded: ${event.eventType} for budget ${data.budgetId} orgId=${data.orgId}`,
      );
    } catch (err: unknown) {
      this.logger.error('Failed to persist alert event', err);
      channel.nack(message, false, false);
    }
  }
}
