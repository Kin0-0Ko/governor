import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SpendEvent } from './entities/spend-event.entity';

export interface SpendQuery {
  orgId: string;
  jobId?: string;
  targetId?: string;
  provider?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class SpendService {
  constructor(
    @InjectRepository(SpendEvent)
    private readonly spendRepo: Repository<SpendEvent>,
  ) {}

  async query(params: SpendQuery) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 50, 500);
    const skip = (page - 1) * limit;

    const qb = this.spendRepo.createQueryBuilder('e')
      .where('e.orgId = :orgId', { orgId: params.orgId });

    if (params.jobId) qb.andWhere('e.jobId = :jobId', { jobId: params.jobId });
    if (params.targetId) qb.andWhere('e.targetId = :targetId', { targetId: params.targetId });
    if (params.provider) qb.andWhere('e.provider = :provider', { provider: params.provider });
    if (params.from) qb.andWhere('e.requestTimestamp >= :from', { from: new Date(params.from) });
    if (params.to) qb.andWhere('e.requestTimestamp <= :to', { to: new Date(params.to) });

    qb.orderBy('e.requestTimestamp', 'DESC').skip(skip).take(limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      total,
      page,
      limit,
      items: items.map((e) => ({
        id: e.id,
        jobId: e.jobId,
        targetId: e.targetId,
        provider: e.provider,
        features: e.features,
        baseRateMicros: e.baseRateMicros.toString(),
        totalCostMicros: e.totalCostMicros.toString(),
        multiplierSum: e.multiplierSum,
        decision: e.decision,
        requestTimestamp: e.requestTimestamp.toISOString(),
      })),
    };
  }
}
