import { MigrationInterface, QueryRunner } from 'typeorm';

export class BudgetsDeletedAt1000000000006 implements MigrationInterface {
  name = 'BudgetsDeletedAt1000000000006';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "budgets" ADD COLUMN "deletedAt" TIMESTAMP WITH TIME ZONE`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "budgets" DROP COLUMN "deletedAt"`);
  }
}
