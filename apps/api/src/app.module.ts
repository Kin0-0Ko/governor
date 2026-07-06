import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Budget } from './budgets/entities/budget.entity';
import { Provider } from './providers/entities/provider.entity';
import { SpendEvent } from './spend/entities/spend-event.entity';
import { AlertEvent } from './alerts/entities/alert-event.entity';
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

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env['DB_HOST'] ?? 'localhost',
      port: parseInt(process.env['DB_PORT'] ?? '5432', 10),
      username: process.env['DB_USER'] ?? 'governor',
      password: process.env['DB_PASS'] ?? 'governor',
      database: process.env['DB_NAME'] ?? 'governor',
      entities: [Budget, Provider, SpendEvent, AlertEvent],
      synchronize: false,
    }),
    TypeOrmModule.forFeature([Budget, Provider, SpendEvent, AlertEvent]),
    EventsModule,
    BudgetStoreModule,
  ],
  controllers: [BudgetsController, EnforceController, SpendController, StreamController],
  providers: [BudgetsService, EnforceService, SpendService, StreamService],
})
export class AppModule {}
