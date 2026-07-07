import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { spendQueueOptions } from '@governor/messaging-contracts';
import { SpendEvent } from './entities/spend-event.entity';
import { AlertEvent } from './entities/alert-event.entity';
import { OutboxEvent } from './entities/outbox-event.entity';
import { SpendRollupConsumer } from './spend-rollup/spend-rollup.consumer';
import { AlertsConsumer } from './alerts/alerts.consumer';
import { OutboxPollerConsumer } from './outbox/outbox-poller.consumer';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env['DB_HOST'] ?? 'localhost',
      port: parseInt(process.env['DB_PORT'] ?? '5432', 10),
      username: process.env['DB_APP_USER'] ?? 'governor_api',
      password: process.env['DB_APP_PASS'] ?? process.env['DB_PASS'] ?? 'governor_dev',
      database: process.env['DB_NAME'] ?? 'governor',
      entities: [SpendEvent, AlertEvent, OutboxEvent],
      synchronize: false,
    }),
    TypeOrmModule.forFeature([SpendEvent, AlertEvent, OutboxEvent]),
    ClientsModule.register([
      {
        name: 'OUTBOX_RMQ_CLIENT',
        transport: Transport.RMQ,
        options: spendQueueOptions,
      },
    ]),
  ],
  controllers: [SpendRollupConsumer, AlertsConsumer],
  providers: [OutboxPollerConsumer],
})
export class WorkerModule {}
