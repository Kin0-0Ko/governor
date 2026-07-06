import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

export interface MultiplierRule {
  feature: string;
  addend: number;
}

@Entity('providers')
@Unique(['name'])
export class Provider {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', nullable: false })
  name!: string;

  @Column({ type: 'bigint', nullable: false, transformer: { to: (v: bigint) => v.toString(), from: (v: string) => BigInt(v) } })
  baseRateMicros!: bigint;

  @Column({ type: 'jsonb', nullable: false, default: [] })
  multiplierRules!: MultiplierRule[];

  @Column({ type: 'boolean', nullable: false, default: true })
  active!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
