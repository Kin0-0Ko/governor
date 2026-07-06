import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { BudgetStoreService } from '@governor/budget-store';

const REDIS_CLIENT = 'REDIS_CLIENT';

@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () =>
        new Redis({
          host: process.env['REDIS_HOST'] ?? 'localhost',
          port: parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
          lazyConnect: true,
          maxRetriesPerRequest: 3,
          retryStrategy: (times: number) => Math.min(times * 100, 3000),
        }),
    },
    {
      provide: BudgetStoreService,
      useFactory: (redis: Redis) => new BudgetStoreService(redis),
      inject: [REDIS_CLIENT],
    },
  ],
  exports: [BudgetStoreService],
})
export class BudgetStoreModule {}
