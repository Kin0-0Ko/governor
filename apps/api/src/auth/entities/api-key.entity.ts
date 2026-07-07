import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', nullable: false })
  orgId!: string;

  @Column({ type: 'varchar', nullable: false, unique: true })
  keyHash!: string;

  @Column({ type: 'varchar', nullable: true })
  label?: string;

  @Column({ type: 'boolean', nullable: false, default: true })
  active!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt?: Date;
}
