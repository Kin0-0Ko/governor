import { Controller, Get, Query } from '@nestjs/common';
import { SpendService, SpendQuery } from './spend.service';

@Controller('v1/spend')
export class SpendController {
  constructor(private readonly spendService: SpendService) {}

  @Get()
  async query(
    @Query('orgId') orgId: string,
    @Query('jobId') jobId?: string,
    @Query('targetId') targetId?: string,
    @Query('provider') provider?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const params: SpendQuery = {
      orgId,
      jobId,
      targetId,
      provider,
      from,
      to,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    };
    return this.spendService.query(params);
  }
}
