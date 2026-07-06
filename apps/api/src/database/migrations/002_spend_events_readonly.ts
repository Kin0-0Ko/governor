import { MigrationInterface, QueryRunner } from 'typeorm';

export class SpendEventsReadonly1000000000002 implements MigrationInterface {
  name = 'SpendEventsReadonly1000000000002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE ROLE IF NOT EXISTS api_role`);
    await queryRunner.query(`REVOKE UPDATE, DELETE ON spend_events FROM api_role`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`GRANT UPDATE, DELETE ON spend_events TO api_role`);
  }
}
