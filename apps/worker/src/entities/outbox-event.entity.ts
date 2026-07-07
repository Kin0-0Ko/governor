import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

export enum OutboxEventStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

@Entity('outbox_events')
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', nullable: false })
  routingKey!: string;

  @Column({ type: 'jsonb', nullable: false })
  payload!: Record<string, unknown>;

  @Index()
  @Column({ type: 'enum', enum: OutboxEventStatus, default: OutboxEventStatus.PENDING })
  status!: OutboxEventStatus;

  @Column({ type: 'int', nullable: false, default: 0 })
  attempts!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt?: Date;
}
