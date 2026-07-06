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
} from '@nestjs/common';
import { BudgetsService, CreateBudgetDto, UpdateBudgetDto } from './budgets.service';
import { BudgetStoreService } from '@governor/budget-store';

@Controller('v1/budgets')
export class BudgetsController {
  constructor(
    private readonly budgetsService: BudgetsService,
    private readonly budgetStore: BudgetStoreService,
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

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const budget = await this.budgetsService.findById(id);
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
  async update(@Param('id') id: string, @Body() dto: UpdateBudgetDto) {
    const budget = await this.budgetsService.update(id, dto);
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
  async remove(@Param('id') id: string): Promise<void> {
    await this.budgetsService.softDelete(id);
  }

  @Post(':id/reset')
  async reset(@Param('id') id: string) {
    const budget = await this.budgetsService.findById(id);
    const previousState = await this.budgetStore.resetCircuit(budget.orgId, id);
    return {
      budgetId: id,
      previousState,
      newState: 'CLOSED',
      resetAt: new Date().toISOString(),
    };
  }
}
