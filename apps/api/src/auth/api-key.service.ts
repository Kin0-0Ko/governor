import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { Cluster, Redis } from 'ioredis';
import { ApiKey } from './entities/api-key.entity';
import { REDIS_CLIENT } from '../budget-store/budget-store.module';

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

function redisKeyFor(keyHash: string): string {
  return `apikey:${keyHash}`;
}

@Injectable()
export class ApiKeyService {
  constructor(
    @InjectRepository(ApiKey)
    private readonly apiKeyRepo: Repository<ApiKey>,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis | Cluster,
  ) {}

  /** Creates a new key for an org, returns the raw key exactly once. */
  async create(orgId: string, label?: string): Promise<{ id: string; rawKey: string }> {
    const rawKey = randomBytes(32).toString('hex');
    const keyHash = hashKey(rawKey);

    const entity = this.apiKeyRepo.create({ orgId, keyHash, label, active: true });
    const saved = await this.apiKeyRepo.save(entity);

    await this.redis.set(redisKeyFor(keyHash), orgId);

    return { id: saved.id, rawKey };
  }

  async revoke(id: string): Promise<void> {
    const key = await this.apiKeyRepo.findOneBy({ id });
    if (!key) return;
    key.active = false;
    await this.apiKeyRepo.save(key);
    await this.redis.del(redisKeyFor(key.keyHash));
  }

  /**
   * Cold-path fallback used only on a Redis cache miss (e.g. key created before
   * a Redis flush, or first request after key creation raced the cache warm).
   * Not on the steady-state hot path — Constitution Principle I is preserved
   * because the common case resolves entirely from Redis in ApiKeyGuard.
   */
  async resolveOrgIdFromKey(rawKey: string): Promise<string | null> {
    const keyHash = hashKey(rawKey);
    const key = await this.apiKeyRepo.findOneBy({ keyHash, active: true });
    if (!key) return null;

    await this.redis.set(redisKeyFor(keyHash), key.orgId);
    void this.apiKeyRepo.update(key.id, { lastUsedAt: new Date() });

    return key.orgId;
  }
}
