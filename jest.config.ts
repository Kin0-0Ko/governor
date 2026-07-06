import type { Config } from 'jest';

const config: Config = {
  projects: [
    '<rootDir>/libs/cost-engine',
    '<rootDir>/libs/budget-store',
    '<rootDir>/libs/playwright-hook',
    '<rootDir>/apps/api',
    '<rootDir>/apps/worker',
    '<rootDir>/apps/dashboard'
  ]
};

export default config;
