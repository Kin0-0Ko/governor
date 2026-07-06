import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import Redis from 'ioredis';
import type { EnforcementState } from '@governor/cost-engine';

export interface EnforceParams {
  orgId: string;
  budgetId: string;
  costMicros: bigint;
  ttlSeconds: number;
}

export interface EnforceOutcome {
  allowed: boolean;
  /** FSM state after enforcement; 'ALLOWED'/'TRIPPED' are pseudo-states for outcome clarity */
  state: EnforcementState | 'ALLOWED' | 'TRIPPED';
  spendMicros: bigint;
  remainingMicros: bigint;
}

export interface BudgetState {
  state: string;
  spendMicros: bigint;
  remainingMicros: bigint;
}

// Resolves to libs/budget-store/src/lua/enforce.lua regardless of CWD or Jest rootDir
const LUA_SCRIPT = readFileSync(
  join(__dirname, '../lua/enforce.lua'),
  'utf8',
);

@Injectable()
export class BudgetStoreService implements OnModuleInit {
  private readonly logger = new Logger(BudgetStoreService.name);
  private scriptSha: string | null = null;

  constructor(private readonly redis: Redis) {}

  async onModuleInit(): Promise<void> {
    try {
      this.scriptSha = await this.redis.script('LOAD', LUA_SCRIPT) as string;
      this.logger.log(`enforce.lua loaded, SHA=${this.scriptSha}`);
    } catch (err) {
      this.logger.error('Failed to load enforce.lua on bootstrap', err);
      // Service starts degraded — evalEnforce will fail-safe deny
    }
  }

  /**
   * Atomically evaluates budget enforcement via EVALSHA.
   * All keys use Hash Tags {orgId:budgetId} for Redis Cluster slot locality.
   * Fails safe: returns STORE_UNAVAILABLE deny on any Redis error.
   */
  async evalEnforce(params: EnforceParams): Promise<EnforceOutcome> {
    const { orgId, budgetId, costMicros, ttlSeconds } = params;
    const tag = `{${orgId}:${budgetId}}`;
    const keys = [
      `budget:${tag}:state`,
      `budget:${tag}:spend`,
      `budget:${tag}:cap`,
      `budget:${tag}:ttl_exp`,
    ];
    const nowUnix = Math.floor(Date.now() / 1000);

    try {
      const raw = await this.evalScript(
        keys,
        [String(costMicros), String(nowUnix), String(ttlSeconds)],
      );

      const [allowed, state, spendStr, remainingStr] = raw as [number, string, string, string];
      return {
        allowed: allowed === 1,
        state: state as EnforceOutcome['state'],
        spendMicros: BigInt(spendStr),
        remainingMicros: BigInt(remainingStr),
      };
    } catch (err) {
      this.logger.error('Redis enforce error — fail-safe deny', err);
      return {
        allowed: false,
        state: 'STORE_UNAVAILABLE',
        spendMicros: 0n,
        remainingMicros: 0n,
      };
    }
  }

  /**
   * Warms the cap key in Redis when a budget is created or updated.
   * Uses the same Hash Tag for slot locality.
   */
  async warmCapKey(orgId: string, budgetId: string, capMicros: bigint): Promise<void> {
    const tag = `{${orgId}:${budgetId}}`;
    await this.redis.set(`budget:${tag}:cap`, String(capMicros));
  }

  /**
   * Reads current circuit state and spend from Redis.
   * Used by GET /v1/budgets/:id to return live circuit data.
   */
  async getState(orgId: string, budgetId: string, capMicros: bigint): Promise<BudgetState> {
    const tag = `{${orgId}:${budgetId}}`;
    try {
      const [state, spendStr] = await Promise.all([
        this.redis.get(`budget:${tag}:state`),
        this.redis.get(`budget:${tag}:spend`),
      ]);
      const spend = BigInt(spendStr ?? '0');
      const remaining = capMicros - spend < 0n ? 0n : capMicros - spend;
      return {
        state: state ?? 'CLOSED',
        spendMicros: spend,
        remainingMicros: remaining,
      };
    } catch {
      return { state: 'STORE_UNAVAILABLE', spendMicros: 0n, remainingMicros: 0n };
    }
  }

  /**
   * Resets circuit breaker to CLOSED state for a budget scope.
   * Called by POST /v1/budgets/:id/reset.
   */
  async resetCircuit(orgId: string, budgetId: string): Promise<string> {
    const tag = `{${orgId}:${budgetId}}`;
    const stateKey = `budget:${tag}:state`;
    const previous = (await this.redis.get(stateKey)) ?? 'CLOSED';
    await this.redis.set(stateKey, 'CLOSED');
    return previous;
  }

  private async evalScript(keys: string[], args: string[]): Promise<unknown> {
    if (this.scriptSha) {
      try {
        return await (this.redis as any).evalsha(this.scriptSha, keys.length, ...keys, ...args);
      } catch (err: any) {
        if (err?.message?.includes('NOSCRIPT')) {
          // Script evicted from Redis — reload and retry once
          this.scriptSha = await this.redis.script('LOAD', LUA_SCRIPT) as string;
          return await (this.redis as any).evalsha(this.scriptSha, keys.length, ...keys, ...args);
        }
        throw err;
      }
    }
    // Fallback to EVAL if SCRIPT LOAD failed at startup
    return await (this.redis as any).eval(LUA_SCRIPT, keys.length, ...keys, ...args);
  }
}
