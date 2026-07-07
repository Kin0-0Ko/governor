import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OutboxEvent } from './entities/outbox-event.entity';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
  ) {}

  /** Durably records an event that failed immediate delivery, for later redelivery by the worker's poller. */
  async recordFallback(routingKey: string, payload: Record<string, unknown>): Promise<void> {
    try {
      const event = this.outboxRepo.create({ routingKey, payload });
      await this.outboxRepo.save(event);
    } catch (err) {
      this.logger.error(`Failed to record outbox fallback for ${routingKey}`, err);
    }
  }
}
