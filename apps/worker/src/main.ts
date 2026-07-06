import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice(WorkerModule, {
    transport: Transport.RMQ,
    options: {
      urls: [process.env['RABBITMQ_URL'] ?? 'amqp://governor:governor_dev@localhost:5672'],
      queue: 'governor.spend',
      queueOptions: {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'governor.events.dlx',
          'x-dead-letter-routing-key': 'governor.spend.dlq',
        },
      },
      noAck: false,
    },
  });
  await app.listen();
}

bootstrap();
