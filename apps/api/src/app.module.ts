import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Budget } from './budgets/entities/budget.entity';
import { Provider } from './providers/entities/provider.entity';
import { SpendEvent } from './spend/entities/spend-event.entity';
import { AlertEvent } from './alerts/entities/alert-event.entity';
import { ApiKey } from './auth/entities/api-key.entity';
import { OutboxEvent } from './outbox/entities/outbox-event.entity';
import { BudgetsController } from './budgets/budgets.controller';
import { BudgetsService } from './budgets/budgets.service';
import { EnforceController } from './enforce/enforce.controller';
import { EnforceService } from './enforce/enforce.service';
import { SpendController } from './spend/spend.controller';
import { SpendService } from './spend/spend.service';
import { StreamController } from './stream/stream.controller';
import { StreamService } from './stream/stream.service';
import { EventsModule } from './messaging/events.module';
import { BudgetStoreModule } from './budget-store/budget-store.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 1000, limit: 20 }]),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env['DB_HOST'] ?? 'localhost',
      port: parseInt(process.env['DB_PORT'] ?? '5432', 10),
      username: process.env['DB_APP_USER'] ?? 'governor_api',
      password: process.env['DB_APP_PASS'] ?? process.env['DB_PASS'] ?? 'governor_dev',
      database: process.env['DB_NAME'] ?? 'governor',
      entities: [Budget, Provider, SpendEvent, AlertEvent, ApiKey, OutboxEvent],
      synchronize: false,
    }),
    TypeOrmModule.forFeature([Budget, Provider, SpendEvent, AlertEvent]),
    EventsModule,
    BudgetStoreModule,
    AuthModule,
    HealthModule,
  ],
  controllers: [BudgetsController, EnforceController, SpendController, StreamController],
  providers: [
    BudgetsService,
    EnforceService,
    SpendService,
    StreamService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
