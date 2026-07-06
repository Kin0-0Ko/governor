import { AppDataSource } from '../data-source';
import { Provider } from '../../providers/entities/provider.entity';

async function seed(): Promise<void> {
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(Provider);

  const providers = [
    {
      name: 'scraperapi',
      baseRateMicros: 1_000_000n,
      multiplierRules: [
        { feature: 'jsRender', addend: 5 },
        { feature: 'residential', addend: 3 },
      ],
      active: true,
    },
    {
      name: 'brightdata',
      baseRateMicros: 2_000_000n,
      multiplierRules: [
        { feature: 'residential', addend: 3 },
      ],
      active: true,
    },
  ];

  for (const p of providers) {
    const existing = await repo.findOneBy({ name: p.name });
    if (!existing) {
      await repo.save(repo.create(p));
      console.log(`Seeded provider: ${p.name}`);
    } else {
      console.log(`Provider already exists: ${p.name}`);
    }
  }

  await AppDataSource.destroy();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
