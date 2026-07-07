import { createHash, randomBytes } from 'crypto';
import { AppDataSource } from '../data-source';
import { ApiKey } from '../../auth/entities/api-key.entity';

async function seed(): Promise<void> {
  const orgId = process.argv[2];
  const label = process.argv[3];

  if (!orgId) {
    console.error('Usage: ts-node api-key.seed.ts <orgId> [label]');
    process.exit(1);
  }

  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(ApiKey);

  const rawKey = randomBytes(32).toString('hex');
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  const entity = repo.create({ orgId, keyHash, label, active: true });
  await repo.save(entity);

  console.log(`API key created for orgId="${orgId}"`);
  console.log(`Raw key (shown once): ${rawKey}`);

  await AppDataSource.destroy();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
