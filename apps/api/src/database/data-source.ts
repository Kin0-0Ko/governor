import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Budget } from '../budgets/entities/budget.entity';
import { Provider } from '../providers/entities/provider.entity';
import { SpendEvent } from '../spend/entities/spend-event.entity';
import { AlertEvent } from '../alerts/entities/alert-event.entity';
import { ApiKey } from '../auth/entities/api-key.entity';
import { OutboxEvent } from '../outbox/entities/outbox-event.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env['DB_HOST'] ?? 'localhost',
  port: parseInt(process.env['DB_PORT'] ?? '5432', 10),
  username: process.env['DB_USER'] ?? 'governor',
  password: process.env['DB_PASS'] ?? 'governor_dev',
  database: process.env['DB_NAME'] ?? 'governor',
  entities: [Budget, Provider, SpendEvent, AlertEvent, ApiKey, OutboxEvent],
  migrations: [__dirname + '/migrations/*.ts'],
  synchronize: false,
  logging: process.env['NODE_ENV'] !== 'production',
});
