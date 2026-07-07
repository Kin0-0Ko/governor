import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ClientProxy } from '@nestjs/microservices';
import { OutboxEvent, OutboxEventStatus } from '../entities/outbox-event.entity';

const POLL_INTERVAL_MS = 5000;
const MAX_ATTEMPTS = 10;

@Injectable()
export class OutboxPollerConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPollerConsumer.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
    @Inject('OUTBOX_RMQ_CLIENT')
    private readonly rmqClient: ClientProxy,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.poll().catch((err) => this.logger.error('Outbox poll failed', err));
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    const pending = await this.outboxRepo.find({
      where: { status: In([OutboxEventStatus.PENDING, OutboxEventStatus.FAILED]) },
      take: 50,
    });

    for (const event of pending) {
      if (event.attempts >= MAX_ATTEMPTS) continue;

      try {
        await new Promise<void>((resolve, reject) => {
          this.rmqClient.emit(event.routingKey, event.payload).subscribe({
            next: () => resolve(),
            error: (err: unknown) => reject(err),
          });
        });

        event.status = OutboxEventStatus.SENT;
        event.sentAt = new Date();
        await this.outboxRepo.save(event);
      } catch (err) {
        event.status = OutboxEventStatus.FAILED;
        event.attempts += 1;
        await this.outboxRepo.save(event);
        this.logger.warn(`Outbox redelivery failed for event ${event.id} (attempt ${event.attempts})`, err as Error);
      }
    }
  }
}
