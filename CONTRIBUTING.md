# Contributing to Governor

## Setup

```bash
git clone https://github.com/Kin0-0Ko/governor.git
cd governor
pnpm install
docker compose up -d          # Redis, PostgreSQL, RabbitMQ
pnpm nx test cost-engine      # verify baseline
pnpm nx test budget-store
```

## Branch naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/<scope>/<description>` | `feat/cost-engine/brightdata-adapter` |
| Bug fix | `fix/<scope>/<description>` | `fix/budget-store/lua-float-output` |
| Chore | `chore/<description>` | `chore/update-nx` |

## Commit format (Conventional Commits)

```
<type>(<scope>): <subject>

[optional body]

[optional footer: BREAKING CHANGE: ...]
```

**Types**: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`

**Scopes**: `cost-engine`, `budget-store`, `playwright-hook`, `api`, `worker`, `dashboard`

Commits drive automatic semver bumps via `nx release`:
- `feat:` → MINOR bump on affected public package
- `fix:` → PATCH bump
- `BREAKING CHANGE:` footer → MAJOR bump

## Constitution check (mandatory for every PR)

Every PR **must** confirm all 6 principles in the PR description:

- [ ] **I.** Hot Path uses Redis Lua only — no DB/HTTP calls added to enforce path
- [ ] **II.** No `number` type used for any monetary value — BigInt only
- [ ] **III.** Hot Path p99 < 10ms not regressed (benchmark if enforce path touched)
- [ ] **IV.** `pnpm nx lint` passes — no NX boundary violations
- [ ] **V.** Tests written before or alongside implementation (TDD)
- [ ] **VI.** All ALLOW/DENY/TRIP decisions emit structured logs

## For public lib changes (`@governor/*`)

- No breaking change without `BREAKING CHANGE:` in commit footer
- CHANGELOG entry generated automatically by `nx release` — do not edit manually
- `peerDependencies` updated if new runtime peer required
- Zero runtime dependencies on `@governor/cost-engine`
- `@governor/playwright-hook` peer-depends on `playwright` ≥1.40 only

## Custom pricing adapters

Implement `CostAdapter` from `@governor/cost-engine`:

```typescript
import { CostAdapter, CostSignal, ProviderConfig, computeCostMicros } from '@governor/cost-engine';

export class MyProviderAdapter implements CostAdapter {
  readonly provider = 'myprovider';
  computeCost(signal: CostSignal, config: ProviderConfig): bigint {
    return computeCostMicros(config.baseRateMicros, signal.features, config.multiplierRules);
  }
}
```

Include unit tests. No I/O in adapter logic.

## PR process

1. Fork → branch → implement → `pnpm nx affected --target=test,lint,build`
2. Open PR against `main`
3. Fill constitution check in PR description
4. One maintainer approval required
5. Squash-merge preferred for clean history
