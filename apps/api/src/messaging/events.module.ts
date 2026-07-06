import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { rabbitmqUrl, RABBITMQ_QUEUE_SPEND, RABBITMQ_EXCHANGE } from './rabbitmq.config';

export const RABBITMQ_CLIENT = 'RABBITMQ_CLIENT';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: RABBITMQ_CLIENT,
        transport: Transport.RMQ,
        options: {
          urls: [rabbitmqUrl],
          queue: RABBITMQ_QUEUE_SPEND,
          queueOptions: {
            durable: true,
            arguments: {
              'x-dead-letter-exchange': `${RABBITMQ_EXCHANGE}.dlx`,
            },
          },
          exchange: RABBITMQ_EXCHANGE,
          exchangeType: 'topic',
          noAck: false,
        },
      },
    ]),
  ],
  exports: [ClientsModule],
})
export class EventsModule {}
