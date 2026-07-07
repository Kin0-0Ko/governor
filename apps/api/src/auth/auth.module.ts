import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { ApiKey } from './entities/api-key.entity';
import { ApiKeyService } from './api-key.service';
import { ApiKeyGuard } from './api-key.guard';
import { BudgetStoreModule } from '../budget-store/budget-store.module';

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey]), BudgetStoreModule],
  providers: [
    ApiKeyService,
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
  exports: [ApiKeyService],
})
export class AuthModule {}
