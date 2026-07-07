import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApiRoleGrant1000000000005 implements MigrationInterface {
  name = 'ApiRoleGrant1000000000005';

  async up(queryRunner: QueryRunner): Promise<void> {
    const password = process.env['DB_APP_PASS'] ?? process.env['DB_PASS'] ?? 'governor_dev';
    const dbName = process.env['DB_NAME'] ?? 'governor';

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'governor_api') THEN
          CREATE ROLE governor_api LOGIN PASSWORD '${password}';
        END IF;
      END
      $$;
    `);
    await queryRunner.query(`GRANT api_role TO governor_api`);
    await queryRunner.query(`GRANT CONNECT ON DATABASE "${dbName}" TO governor_api`);
    await queryRunner.query(`GRANT USAGE ON SCHEMA public TO governor_api`);
    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO governor_api`,
    );
    await queryRunner.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO governor_api`,
    );
    // Re-assert the spend_events append-only restriction for the new login role
    // (table-level GRANT above would otherwise re-open it — migration 002's revoke
    // targets api_role, which governor_api now inherits, but PostgreSQL grants are
    // additive across role membership so the direct grant must be revoked explicitly).
    await queryRunner.query(`REVOKE UPDATE, DELETE ON spend_events FROM governor_api`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`REVOKE api_role FROM governor_api`);
    await queryRunner.query(`DROP ROLE IF EXISTS governor_api`);
  }
}
