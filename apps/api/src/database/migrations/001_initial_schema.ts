import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1000000000001 implements MigrationInterface {
  name = 'InitialSchema1000000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "budgets" (
        "id" uuid DEFAULT gen_random_uuid() NOT NULL,
        "orgId" character varying NOT NULL,
        "jobId" character varying NOT NULL,
        "targetId" character varying NOT NULL,
        "capMicros" bigint NOT NULL,
        "halfOpenTtlSeconds" integer NOT NULL DEFAULT 60,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_budgets_scope" UNIQUE ("orgId", "jobId", "targetId"),
        CONSTRAINT "PK_budgets" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_budgets_orgId" ON "budgets" ("orgId")`);
    await queryRunner.query(`CREATE INDEX "IDX_budgets_jobId" ON "budgets" ("jobId")`);
    await queryRunner.query(`CREATE INDEX "IDX_budgets_targetId" ON "budgets" ("targetId")`);

    await queryRunner.query(`
      CREATE TABLE "providers" (
        "id" uuid DEFAULT gen_random_uuid() NOT NULL,
        "name" character varying NOT NULL,
        "baseRateMicros" bigint NOT NULL,
        "multiplierRules" jsonb NOT NULL DEFAULT '[]',
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_providers_name" UNIQUE ("name"),
        CONSTRAINT "PK_providers" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "spend_decision_enum" AS ENUM ('ALLOWED', 'DENIED', 'TRIPPED')
    `);

    await queryRunner.query(`
      CREATE TABLE "spend_events" (
        "id" uuid DEFAULT gen_random_uuid() NOT NULL,
        "idempotencyKey" character varying NOT NULL,
        "orgId" character varying NOT NULL,
        "jobId" character varying NOT NULL,
        "targetId" character varying NOT NULL,
        "budgetId" uuid NOT NULL,
        "provider" character varying NOT NULL,
        "baseRateMicros" bigint NOT NULL,
        "totalCostMicros" bigint NOT NULL,
        "multiplierSum" integer NOT NULL DEFAULT 1,
        "features" text NOT NULL DEFAULT '',
        "decision" "spend_decision_enum" NOT NULL,
        "requestTimestamp" TIMESTAMP WITH TIME ZONE NOT NULL,
        "recordedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "UQ_spend_events_idempotencyKey" UNIQUE ("idempotencyKey"),
        CONSTRAINT "PK_spend_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_spend_events_budgetId" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_spend_events_orgId" ON "spend_events" ("orgId")`);
    await queryRunner.query(`CREATE INDEX "IDX_spend_events_jobId" ON "spend_events" ("jobId")`);
    await queryRunner.query(`CREATE INDEX "IDX_spend_events_targetId" ON "spend_events" ("targetId")`);

    await queryRunner.query(`
      CREATE TYPE "alert_event_type_enum" AS ENUM (
        'BUDGET_BREACHED', 'CIRCUIT_TRIPPED', 'HALF_OPEN_PROBE', 'CIRCUIT_RESET'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "alert_events" (
        "id" uuid DEFAULT gen_random_uuid() NOT NULL,
        "budgetId" uuid NOT NULL,
        "orgId" character varying NOT NULL,
        "eventType" "alert_event_type_enum" NOT NULL,
        "spendAtEventMicros" bigint NOT NULL,
        "capMicros" bigint NOT NULL,
        "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_alert_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_alert_events_budgetId" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_alert_events_orgId" ON "alert_events" ("orgId")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "alert_events"`);
    await queryRunner.query(`DROP TYPE "alert_event_type_enum"`);
    await queryRunner.query(`DROP TABLE "spend_events"`);
    await queryRunner.query(`DROP TYPE "spend_decision_enum"`);
    await queryRunner.query(`DROP TABLE "providers"`);
    await queryRunner.query(`DROP TABLE "budgets"`);
  }
}
