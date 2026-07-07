import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { BudgetStoreModule } from '../budget-store/budget-store.module';

@Module({
  imports: [TerminusModule, BudgetStoreModule],
  controllers: [HealthController],
})
export class HealthModule {}
