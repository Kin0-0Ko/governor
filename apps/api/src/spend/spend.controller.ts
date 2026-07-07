import { Controller, Get, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { IsOptional, IsString, IsInt, Min, Max, IsISO8601 } from 'class-validator';
import { Type } from 'class-transformer';
import { SpendService, SpendQuery } from './spend.service';

interface AuthedRequest extends Request {
  orgId: string;
}

export class SpendQueryDto {
  /** Accepted but ignored — the authenticated caller's org always wins (FR-008). */
  @IsOptional() @IsString() orgId?: string;
  @IsOptional() @IsString() jobId?: string;
  @IsOptional() @IsString() targetId?: string;
  @IsOptional() @IsString() provider?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsInt() @Min(1) @Type(() => Number) page?: number;
  @IsOptional() @IsInt() @Min(1) @Max(500) @Type(() => Number) limit?: number;
}

@Controller('v1/spend')
export class SpendController {
  constructor(private readonly spendService: SpendService) {}

  @Get()
  async query(@Query() dto: SpendQueryDto, @Req() req: AuthedRequest) {
    const params: SpendQuery = {
      orgId: req.orgId,
      jobId: dto.jobId,
      targetId: dto.targetId,
      provider: dto.provider,
      from: dto.from,
      to: dto.to,
      page: dto.page,
      limit: dto.limit,
    };
    return this.spendService.query(params);
  }
}
