import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Unique,
  Index,
} from 'typeorm';

@Entity('budgets')
@Unique(['orgId', 'jobId', 'targetId'])
export class Budget {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', nullable: false })
  orgId!: string;

  @Index()
  @Column({ type: 'varchar', nullable: false })
  jobId!: string;

  @Index()
  @Column({ type: 'varchar', nullable: false })
  targetId!: string;

  @Column({ type: 'bigint', nullable: false, transformer: { to: (v: bigint) => v.toString(), from: (v: string) => BigInt(v) } })
  capMicros!: bigint;

  @Column({ type: 'int', nullable: false, default: 60 })
  halfOpenTtlSeconds!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt?: Date;
}
