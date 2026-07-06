import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Unique,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Budget } from '../../budgets/entities/budget.entity';

export enum SpendDecision {
  ALLOWED = 'ALLOWED',
  DENIED = 'DENIED',
  TRIPPED = 'TRIPPED',
}

const bigintTransformer = {
  to: (v: bigint) => v.toString(),
  from: (v: string) => BigInt(v),
};

@Entity('spend_events')
@Unique(['idempotencyKey'])
export class SpendEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', nullable: false })
  idempotencyKey!: string;

  @Index()
  @Column({ type: 'varchar', nullable: false })
  orgId!: string;

  @Index()
  @Column({ type: 'varchar', nullable: false })
  jobId!: string;

  @Index()
  @Column({ type: 'varchar', nullable: false })
  targetId!: string;

  @ManyToOne(() => Budget, { nullable: false })
  @JoinColumn({ name: 'budgetId' })
  budget!: Budget;

  @Column({ type: 'uuid', nullable: false })
  budgetId!: string;

  @Column({ type: 'varchar', nullable: false })
  provider!: string;

  @Column({ type: 'bigint', nullable: false, transformer: bigintTransformer })
  baseRateMicros!: bigint;

  @Column({ type: 'bigint', nullable: false, transformer: bigintTransformer })
  totalCostMicros!: bigint;

  @Column({ type: 'int', nullable: false, default: 1 })
  multiplierSum!: number;

  @Column({ type: 'simple-array', nullable: false, default: '' })
  features!: string[];

  @Column({ type: 'enum', enum: SpendDecision, nullable: false })
  decision!: SpendDecision;

  @Column({ type: 'timestamptz', nullable: false })
  requestTimestamp!: Date;

  @Column({ type: 'timestamptz', nullable: false, default: () => 'NOW()' })
  recordedAt!: Date;
}
