import { Module } from '@nestjs/common';
import { Cluster } from 'ioredis';
import { BudgetStoreService } from '@governor/budget-store';

export const REDIS_CLIENT = 'REDIS_CLIENT';

const CLUSTER_PORTS = [7000, 7001, 7002, 7003, 7004, 7005];

function parseClusterNodes(): { host: string; port: number }[] {
  const raw = process.env['REDIS_CLUSTER_NODES'];
  if (raw) {
    return raw.split(',').map((entry) => {
      const [host, port] = entry.split(':');
      return { host, port: parseInt(port, 10) };
    });
  }
  const host = process.env['REDIS_HOST'] ?? 'localhost';
  return CLUSTER_PORTS.map((port) => ({ host, port }));
}

/**
 * CLUSTER SLOTS/NODES reports each node's Docker-internal IP, which isn't
 * reachable from a client running on the host (outside the compose
 * network) — only the published host ports are. Redis Cluster port numbers
 * are unique per node regardless of which container IP fronts them, so
 * mapping "any-internal-ip:port" -> host:same-port via ioredis's natMap
 * function form reliably rewrites topology-discovered addresses without
 * hardcoding a specific Docker subnet.
 */
function natMap(key: string): { host: string; port: number } | null {
  const port = Number(key.split(':')[1]);
  if (!CLUSTER_PORTS.includes(port)) return null;
  return { host: process.env['REDIS_HOST'] ?? 'localhost', port };
}

@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () =>
        new Cluster(parseClusterNodes(), {
          lazyConnect: true,
          natMap: process.env['REDIS_NAT_MAP'] === 'false' ? undefined : natMap,
          redisOptions: {
            maxRetriesPerRequest: 3,
          },
        }),
    },
    {
      provide: BudgetStoreService,
      useFactory: (redis: Cluster) => new BudgetStoreService(redis),
      inject: [REDIS_CLIENT],
    },
  ],
  exports: [BudgetStoreService, REDIS_CLIENT],
})
export class BudgetStoreModule {}
