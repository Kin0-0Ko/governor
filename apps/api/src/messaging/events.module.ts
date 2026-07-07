import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TypeOrmModule } from '@nestjs/typeorm';
import { spendQueueOptions } from '@governor/messaging-contracts';
import { OutboxEvent } from '../outbox/entities/outbox-event.entity';
import { OutboxService } from '../outbox/outbox.service';

export const RABBITMQ_CLIENT = 'RABBITMQ_CLIENT';

@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxEvent]),
    ClientsModule.register([
      {
        name: RABBITMQ_CLIENT,
        transport: Transport.RMQ,
        // ClientProxy uses `options.noAck` for its own reply-queue consumer
        // (RabbitMQ's amq.rabbitmq.reply-to pseudo-queue), not just for the
        // main work queue. spendQueueOptions sets noAck:false, which is
        // correct for the worker's real consumer but is invalid for
        // reply-to — RabbitMQ requires that pseudo-queue be consumed with
        // noAck:true, or it rejects the client's connection with
        // PRECONDITION_FAILED and kills the process. The api never actually
        // uses request-reply (.send()), only .emit(), so noAck:true here
        // has no behavioral effect on emitted messages — the worker's own
        // queueOptions.noAck:false is what governs real message ack/nack.
        options: { ...spendQueueOptions, noAck: true },
      },
    ]),
  ],
  providers: [OutboxService],
  exports: [ClientsModule, OutboxService],
})
export class EventsModule {}
