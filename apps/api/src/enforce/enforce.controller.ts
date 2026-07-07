import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Res,
  Req,
} from '@nestjs/common';
import { IsString, IsNotEmpty, IsArray, IsInt, Min, IsISO8601 } from 'class-validator';
import { Type } from 'class-transformer';
import { Request, Response } from 'express';
import { EnforceService } from './enforce.service';

interface AuthedRequest extends Request {
  orgId: string;
}

export class EnforceRequestDto {
  @IsString() @IsNotEmpty() orgId!: string;
  @IsString() @IsNotEmpty() jobId!: string;
  @IsString() @IsNotEmpty() targetId!: string;
  @IsString() @IsNotEmpty() provider!: string;
  @IsArray() @IsString({ each: true }) features!: string[];
  @IsString() @IsNotEmpty() idempotencyKey!: string;
  @IsISO8601() requestTimestamp!: string;
  @IsInt() @Min(0) @Type(() => Number) retryIndex!: number;
}

@Controller()
export class EnforceController {
  constructor(private readonly enforceService: EnforceService) {}

  @Post('v1/enforce')
  @HttpCode(HttpStatus.OK)
  async enforce(
    @Body() dto: EnforceRequestDto,
    @Res() res: Response,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    if (dto.orgId !== req.orgId) {
      res.status(404).json({ message: 'Not Found' });
      return;
    }

    const result = await this.enforceService.enforce(dto);

    if (result.decision === 'ALLOWED') {
      res.status(200).json({
        decision: 'ALLOWED',
        costMicros: result.costMicros.toString(),
        remainingMicros: result.remainingMicros.toString(),
        state: result.state,
      });
      return;
    }

    if (result.state === 'STORE_UNAVAILABLE') {
      res.status(503).json({
        decision: 'DENIED',
        state: 'STORE_UNAVAILABLE',
        message: 'Enforcement store unreachable. Fail-safe deny.',
      });
      return;
    }

    if (result.state === 'NO_BUDGET') {
      res.status(402).json({
        decision: 'DENIED',
        state: 'NO_BUDGET',
        message: 'No budget configured for scope. Explicit budget required before spend is authorized.',
      });
      return;
    }

    if (result.state === 'UNKNOWN_PROVIDER') {
      res.status(402).json({
        decision: 'DENIED',
        state: 'UNKNOWN_PROVIDER',
        message: `Provider '${dto.provider}' is not registered or inactive. No cost charged.`,
      });
      return;
    }

    res.status(402).json({
      decision: 'DENIED',
      state: result.state,
      budgetId: result.budgetId,
      message: `Budget cap reached for scope ${dto.orgId}/${dto.jobId}/${dto.targetId}`,
    });
  }
}
