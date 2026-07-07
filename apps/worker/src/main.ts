import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import { spendQueueOptions } from '@governor/messaging-contracts';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice(WorkerModule, {
    transport: Transport.RMQ,
    options: spendQueueOptions,
  });
  await app.listen();

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void bootstrap();
