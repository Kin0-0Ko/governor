import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard } from './api-key.guard';
import { REDIS_CLIENT } from '../budget-store/budget-store.module';
import { ApiKeyService } from './api-key.service';

function makeContext(headers: Record<string, string>, query: Record<string, string> = {}) {
  const req: any = { headers, query };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => (() => undefined),
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  let redis: { get: jest.Mock };
  let apiKeyService: { resolveOrgIdFromKey: jest.Mock };
  let reflector: Reflector;
  let guard: ApiKeyGuard;

  beforeEach(() => {
    redis = { get: jest.fn() };
    apiKeyService = { resolveOrgIdFromKey: jest.fn() };
    reflector = new Reflector();
    guard = new ApiKeyGuard(redis as any, apiKeyService as any, reflector);
  });

  it('rejects when no credentials supplied', async () => {
    const ctx = makeContext({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an invalid/unknown key', async () => {
    redis.get.mockResolvedValue(null);
    apiKeyService.resolveOrgIdFromKey.mockResolvedValue(null);
    const ctx = makeContext({ authorization: 'Bearer bad-key' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an inactive key', async () => {
    redis.get.mockResolvedValue(null);
    apiKeyService.resolveOrgIdFromKey.mockResolvedValue(null); // inactive keys resolve to null
    const ctx = makeContext({ authorization: 'Bearer inactive-key' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('attaches orgId to the request on a valid key found in redis cache', async () => {
    redis.get.mockResolvedValue('acme');
    const req: any = { headers: { authorization: 'Bearer good-key' }, query: {} };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => (() => undefined),
      getClass: () => class {},
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(req.orgId).toBe('acme');
    expect(apiKeyService.resolveOrgIdFromKey).not.toHaveBeenCalled();
  });

  it('falls back to Postgres lookup on redis cache miss and warms the cache', async () => {
    redis.get.mockResolvedValue(null);
    apiKeyService.resolveOrgIdFromKey.mockResolvedValue('acme');
    const req: any = { headers: { authorization: 'Bearer good-key' }, query: {} };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => (() => undefined),
      getClass: () => class {},
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(req.orgId).toBe('acme');
    expect(apiKeyService.resolveOrgIdFromKey).toHaveBeenCalled();
  });

  it('accepts a key passed via ?token= query param (for SSE/EventSource)', async () => {
    redis.get.mockResolvedValue('acme');
    const req: any = { headers: {}, query: { token: 'good-key' } };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => (() => undefined),
      getClass: () => class {},
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(req.orgId).toBe('acme');
  });
});
