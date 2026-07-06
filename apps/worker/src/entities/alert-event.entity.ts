import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

export enum AlertEventType {
  BUDGET_BREACHED = 'BUDGET_BREACHED',
  CIRCUIT_TRIPPED = 'CIRCUIT_TRIPPED',
  HALF_OPEN_PROBE = 'HALF_OPEN_PROBE',
  CIRCUIT_RESET = 'CIRCUIT_RESET',
}

const bigintTransformer = {
  to: (v: bigint) => v.toString(),
  from: (v: string) => BigInt(v),
};

@Entity('alert_events')
export class AlertEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: false })
  budgetId!: string;

  @Index()
  @Column({ type: 'varchar', nullable: false })
  orgId!: string;

  @Column({ type: 'enum', enum: AlertEventType, nullable: false })
  eventType!: AlertEventType;

  @Column({ type: 'bigint', nullable: false, transformer: bigintTransformer })
  spendAtEventMicros!: bigint;

  @Column({ type: 'bigint', nullable: false, transformer: bigintTransformer })
  capMicros!: bigint;

  @Column({ type: 'timestamptz', nullable: false, default: () => 'NOW()' })
  occurredAt!: Date;
}
