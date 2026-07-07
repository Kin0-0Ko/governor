import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApiKeys1000000000003 implements MigrationInterface {
  name = 'ApiKeys1000000000003';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "api_keys" (
        "id" uuid DEFAULT gen_random_uuid() NOT NULL,
        "orgId" character varying NOT NULL,
        "keyHash" character varying NOT NULL,
        "label" character varying,
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "lastUsedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "UQ_api_keys_keyHash" UNIQUE ("keyHash"),
        CONSTRAINT "PK_api_keys" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_api_keys_orgId" ON "api_keys" ("orgId")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "api_keys"`);
  }
}
