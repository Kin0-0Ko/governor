import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Inject,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { ClientProxy } from '@nestjs/microservices';
import { BudgetsService, CreateBudgetDto, UpdateBudgetDto } from './budgets.service';
import { BudgetStoreService } from '@governor/budget-store';
import { RABBITMQ_CLIENT } from '../messaging/events.module';
import { RABBITMQ_ROUTING_ALERT } from '../messaging/rabbitmq.config';
import { StreamService } from '../stream/stream.service';

interface AuthedRequest extends Request {
  orgId: string;
}

@Controller('v1/budgets')
export class BudgetsController {
  constructor(
    private readonly budgetsService: BudgetsService,
    private readonly budgetStore: BudgetStoreService,
    @Inject(RABBITMQ_CLIENT)
    private readonly rmqClient: ClientProxy,
    private readonly streamService: StreamService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateBudgetDto) {
    const budget = await this.budgetsService.create(dto);
    return {
      id: budget.id,
      orgId: budget.orgId,
      jobId: budget.jobId,
      targetId: budget.targetId,
      capMicros: budget.capMicros.toString(),
      halfOpenTtlSeconds: budget.halfOpenTtlSeconds,
      createdAt: budget.createdAt.toISOString(),
    };
  }

  @Get()
  async findAll(@Req() req: AuthedRequest) {
    const budgets = await this.budgetsService.findAllByOrg(req.orgId);
    return Promise.all(
      budgets.map(async (budget) => {
        const liveState = await this.budgetStore.getState(budget.orgId, budget.id, budget.capMicros);
        return {
          id: budget.id,
          orgId: budget.orgId,
          jobId: budget.jobId,
          targetId: budget.targetId,
          capMicros: budget.capMicros.toString(),
          halfOpenTtlSeconds: budget.halfOpenTtlSeconds,
          circuitState: liveState.state,
          spendMicros: liveState.spendMicros.toString(),
          remainingMicros: liveState.remainingMicros.toString(),
          updatedAt: budget.updatedAt.toISOString(),
        };
      }),
    );
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: AuthedRequest) {
    const budget = await this.budgetsService.findById(id, req.orgId);
    const liveState = await this.budgetStore.getState(budget.orgId, id, budget.capMicros);
    return {
      id: budget.id,
      orgId: budget.orgId,
      jobId: budget.jobId,
      targetId: budget.targetId,
      capMicros: budget.capMicros.toString(),
      halfOpenTtlSeconds: budget.halfOpenTtlSeconds,
      circuitState: liveState.state,
      spendMicros: liveState.spendMicros.toString(),
      remainingMicros: liveState.remainingMicros.toString(),
      updatedAt: budget.updatedAt.toISOString(),
    };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateBudgetDto, @Req() req: AuthedRequest) {
    const budget = await this.budgetsService.update(id, req.orgId, dto);
    const liveState = await this.budgetStore.getState(budget.orgId, id, budget.capMicros);
    return {
      id: budget.id,
      orgId: budget.orgId,
      jobId: budget.jobId,
      targetId: budget.targetId,
      capMicros: budget.capMicros.toString(),
      halfOpenTtlSeconds: budget.halfOpenTtlSeconds,
      circuitState: liveState.state,
      spendMicros: liveState.spendMicros.toString(),
      remainingMicros: liveState.remainingMicros.toString(),
      updatedAt: budget.updatedAt.toISOString(),
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @Req() req: AuthedRequest): Promise<void> {
    await this.budgetsService.softDelete(id, req.orgId);
  }

  @Post(':id/reset')
  async reset(@Param('id') id: string, @Req() req: AuthedRequest) {
    const budget = await this.budgetsService.findById(id, req.orgId);
    const previousState = await this.budgetStore.resetCircuit(budget.orgId, id);
    const resetAt = new Date().toISOString();

    this.rmqClient.emit(RABBITMQ_ROUTING_ALERT, {
      budgetId: id,
      orgId: budget.orgId,
      eventType: 'CIRCUIT_RESET',
      spendAtEventMicros: '0',
      capMicros: budget.capMicros.toString(),
    }).subscribe({ error: () => undefined });

    this.streamService.emit(id, {
      type: 'reset',
      data: { newState: 'CLOSED', ts: resetAt, budgetId: id },
    });

    return {
      budgetId: id,
      previousState,
      newState: 'CLOSED',
      resetAt,
    };
  }
}
