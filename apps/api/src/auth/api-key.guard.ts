import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { Cluster, Redis } from 'ioredis';
import { REDIS_CLIENT } from '../budget-store/budget-store.module';
import { ApiKeyService } from './api-key.service';
import { IS_PUBLIC_KEY } from './public.decorator';

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

function extractKey(req: { headers: Record<string, string | undefined>; query: Record<string, unknown> }): string | null {
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length);
  }
  const apiKeyHeader = req.headers['x-api-key'];
  if (apiKeyHeader) return apiKeyHeader;

  const token = req.query['token'];
  if (typeof token === 'string') return token;

  return null;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis | Cluster,
    private readonly apiKeyService: ApiKeyService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const rawKey = extractKey(req);
    if (!rawKey) {
      throw new UnauthorizedException('Missing API key');
    }

    const keyHash = hashKey(rawKey);
    let orgId = await this.redis.get(`apikey:${keyHash}`);

    if (!orgId) {
      orgId = await this.apiKeyService.resolveOrgIdFromKey(rawKey);
    }

    if (!orgId) {
      throw new UnauthorizedException('Invalid or inactive API key');
    }

    req.orgId = orgId;
    return true;
  }
}
