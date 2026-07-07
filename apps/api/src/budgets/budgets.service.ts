import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max, Matches } from 'class-validator';
import { Budget } from './entities/budget.entity';
import { BudgetStoreService } from '@governor/budget-store';

export class CreateBudgetDto {
  @IsString() @IsNotEmpty() orgId!: string;
  @IsString() @IsNotEmpty() jobId!: string;
  @IsString() @IsNotEmpty() targetId!: string;
  @IsString() @Matches(/^\d+$/, { message: 'capMicros must be a positive integer string' }) capMicros!: string;
  @IsOptional() @IsInt() @Min(10) @Max(3600) halfOpenTtlSeconds?: number;
}

export class UpdateBudgetDto {
  @IsOptional() @IsString() @Matches(/^\d+$/, { message: 'capMicros must be a positive integer string' }) capMicros?: string;
  @IsOptional() @IsInt() @Min(10) @Max(3600) halfOpenTtlSeconds?: number;
}

@Injectable()
export class BudgetsService {
  constructor(
    @InjectRepository(Budget)
    private readonly budgetRepo: Repository<Budget>,
    private readonly budgetStore: BudgetStoreService,
  ) {}

  async create(dto: CreateBudgetDto): Promise<Budget> {
    const existing = await this.budgetRepo.findOne({
      where: { orgId: dto.orgId, jobId: dto.jobId, targetId: dto.targetId },
    });
    if (existing) {
      throw new ConflictException('Budget already exists for this scope');
    }

    const capMicros = BigInt(dto.capMicros);
    const budget = this.budgetRepo.create({
      orgId: dto.orgId,
      jobId: dto.jobId,
      targetId: dto.targetId,
      capMicros,
      halfOpenTtlSeconds: dto.halfOpenTtlSeconds ?? 60,
    });

    const saved = await this.budgetRepo.save(budget);
    await this.budgetStore.warmCapKey(dto.orgId, saved.id, capMicros);
    return saved;
  }

  /**
   * orgId is required and enforced here (not just at the controller) so that
   * every call site — including future ones — is safe by construction; a
   * mismatch is indistinguishable from not-found (FR-008), never a separate
   * 403, so cross-org callers cannot learn whether a given id exists at all.
   */
  async findById(id: string, orgId: string): Promise<Budget> {
    const budget = await this.budgetRepo.findOneBy({ id });
    if (!budget || budget.orgId !== orgId) {
      throw new NotFoundException(`Budget ${id} not found`);
    }
    return budget;
  }

  async findByScope(orgId: string, jobId: string, targetId: string): Promise<Budget | null> {
    return this.budgetRepo.findOne({ where: { orgId, jobId, targetId } });
  }

  async findAllByOrg(orgId: string): Promise<Budget[]> {
    return this.budgetRepo.find({ where: { orgId } });
  }

  async update(id: string, orgId: string, dto: UpdateBudgetDto): Promise<Budget> {
    const budget = await this.findById(id, orgId);
    if (dto.capMicros !== undefined) {
      budget.capMicros = BigInt(dto.capMicros);
    }
    if (dto.halfOpenTtlSeconds !== undefined) {
      budget.halfOpenTtlSeconds = dto.halfOpenTtlSeconds;
    }
    const saved = await this.budgetRepo.save(budget);
    await this.budgetStore.warmCapKey(saved.orgId, saved.id, saved.capMicros);
    return saved;
  }

  async softDelete(id: string, orgId: string): Promise<void> {
    await this.findById(id, orgId);
    await this.budgetRepo.softDelete(id);
  }
}
