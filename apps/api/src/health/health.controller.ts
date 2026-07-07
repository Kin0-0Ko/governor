import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
  TypeOrmHealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { Cluster, Redis } from 'ioredis';
import { REDIS_CLIENT } from '../budget-store/budget-store.module';
import { Public } from '../auth/public.decorator';

@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis | Cluster,
  ) {}

  @Public()
  @Get('health')
  liveness(): { status: string } {
    return { status: 'ok' };
  }

  @Public()
  @Get('health/ready')
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.db.pingCheck('postgres'),
      () => this.redisCheck('redis'),
    ]);
  }

  private async redisCheck(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.redis.ping();
      return { [key]: { status: 'up' } };
    } catch (err) {
      return { [key]: { status: 'down', message: (err as Error).message } };
    }
  }
}
