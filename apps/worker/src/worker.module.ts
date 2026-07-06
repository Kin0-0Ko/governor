import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SpendEvent } from './entities/spend-event.entity';
import { AlertEvent } from './entities/alert-event.entity';
import { SpendRollupConsumer } from './spend-rollup/spend-rollup.consumer';
import { AlertsConsumer } from './alerts/alerts.consumer';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env['DB_HOST'] ?? 'localhost',
      port: parseInt(process.env['DB_PORT'] ?? '5432', 10),
      username: process.env['DB_USER'] ?? 'governor',
      password: process.env['DB_PASS'] ?? 'governor',
      database: process.env['DB_NAME'] ?? 'governor',
      entities: [SpendEvent, AlertEvent],
      synchronize: false,
    }),
    TypeOrmModule.forFeature([SpendEvent, AlertEvent]),
  ],
  controllers: [SpendRollupConsumer, AlertsConsumer],
  providers: [],
})
export class WorkerModule {}
