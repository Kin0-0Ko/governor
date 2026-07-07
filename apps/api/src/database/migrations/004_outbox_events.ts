import { MigrationInterface, QueryRunner } from 'typeorm';

export class OutboxEvents1000000000004 implements MigrationInterface {
  name = 'OutboxEvents1000000000004';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "outbox_event_status_enum" AS ENUM ('PENDING', 'SENT', 'FAILED')
    `);

    await queryRunner.query(`
      CREATE TABLE "outbox_events" (
        "id" uuid DEFAULT gen_random_uuid() NOT NULL,
        "routingKey" character varying NOT NULL,
        "payload" jsonb NOT NULL,
        "status" "outbox_event_status_enum" NOT NULL DEFAULT 'PENDING',
        "attempts" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "sentAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_outbox_events" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_outbox_events_status" ON "outbox_events" ("status")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "outbox_events"`);
    await queryRunner.query(`DROP TYPE "outbox_event_status_enum"`);
  }
}
