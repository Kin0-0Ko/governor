# Implementation Plan: Scraping Cost Control & Budget Governor

**Branch**: `001-budget-governor` | **Date**: 2026-07-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-budget-governor/spec.md`

## Summary

Build an NX monorepo platform that intercepts Playwright browser requests, evaluates
projected cost against per-scope budget caps via an atomic Redis Lua circuit breaker
(<10ms), attributes spend to Job/Target/Provider with additive multipliers, persists
an append-only PostgreSQL ledger for reconciliation, and surfaces live spend metrics
on a Next.js dashboard via SSE. Each request interception (including retries) is
charged independently; unconfigured scopes are hard-denied.

## Technical Context

**Language/Version**: TypeScript 5.4, Node.js 20 LTS

**Primary Dependencies**:
- NestJS 10 (apps/api, apps/worker)
- Next.js 14 + RTK Query (apps/dashboard)
- ioredis 5 (Hot Path — Lua EVALSHA)
- TypeORM 0.3 + pg (Cold Path — PostgreSQL)
- @nestjs/microservices RmqTransport (RabbitMQ)
- Playwright 1.44 (peer dep in libs/playwright-hook)
- Jest 29 + ioredis-mock (unit tests)
- NX 19 (monorepo orchestration)

**Storage**:
- Redis Cluster (Hot Path enforcement state, circuit breaker FSM)
- PostgreSQL 16 (Cold Path: spend_events, budgets, providers, alert_events)
- RabbitMQ 3.13 (async event bus between api and worker)

**Testing**: Jest (unit + integration), Supertest (API contract tests), ioredis-mock (Lua unit tests)

**Target Platform**: Linux server (Docker Compose dev, Kubernetes prod)

**Project Type**: NX monorepo — web-service (api) + worker + web-app (dashboard) + libraries

**Performance Goals**: Hot Path p99 < 10ms; Cold Path ledger write p99 < 500ms

**Constraints**:
- No floating-point in any monetary computation (BigInt micro-dollars mandatory)
- Hot Path: zero DB queries, zero HTTP calls, single Redis EVALSHA only
- NX module boundary tags enforced at lint-time (build fails on violations)

**Scale/Scope**: ~100 concurrent scopes, ~10k enforce calls/minute per deployment

## Constitution Check

*GATE: Must pass before implementation. Re-checked after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|---------|
| I. Hot/Cold Path Separation | ✅ PASS | Hot Path = Redis Lua only (libs/budget-store). Cold Path = TypeORM + RabbitMQ (apps/worker). Zero cross-path synchronous calls. |
| II. BigInt Financial Arithmetic | ✅ PASS | All monetary fields `bigint` in data model. JSON transport as strings. No `number` type for money anywhere. |
| III. Ultra-Low Latency (<10ms) | ✅ PASS | Single EVALSHA per enforce call. Hash Tags guarantee slot locality. No DB/HTTP on Hot Path. |
| IV. NX Module Boundaries | ✅ PASS | Tag taxonomy defined. ESLint depConstraints configured. scope:domain imports nothing external. |
| V. Test-First | ✅ PASS | Lua scripts tested with ioredis-mock. Domain adapters: pure unit tests. Integration tests use real Redis. |
| VI. Observability | ✅ PASS | Every ALLOW/DENY/TRIP emits structured log + RabbitMQ event. Append-only ledger for reconciliation. |

**No violations. No Complexity Tracking required.**

## Project Structure

### Documentation (this feature)

```text
specs/001-budget-governor/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 — technology decisions
├── data-model.md        # Phase 1 — entity definitions
├── quickstart.md        # Phase 1 — validation guide
├── contracts/
│   └── api.md           # Phase 1 — HTTP + SSE + hook client contracts
└── tasks.md             # Phase 2 (/speckit-tasks output — not yet created)
```

### Source Code (NX Monorepo root)

```text
governor/                          ← repo root
├── nx.json
├── package.json
├── tsconfig.base.json
├── .eslintrc.json                 ← NX module boundary enforcement
│
├── apps/
│   ├── api/                       ← scope:api  (NestJS control plane + ingestion)
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       ├── enforce/           ← Hot Path controller (POST /v1/enforce)
│   │       ├── budgets/           ← Budget CRUD + circuit reset
│   │       ├── spend/             ← Spend query endpoint
│   │       ├── stream/            ← SSE endpoint (@Sse)
│   │       └── providers/         ← Provider config CRUD
│   │
│   ├── worker/                    ← scope:worker (RabbitMQ consumer)
│   │   └── src/
│   │       ├── main.ts
│   │       ├── worker.module.ts
│   │       ├── spend-rollup/      ← Async ledger write + idempotency
│   │       ├── alerts/            ← Budget breach alert dispatch
│   │       └── forecast/          ← Analytical spend forecasting
│   │
│   └── dashboard/                 ← scope:frontend (Next.js 14)
│       └── src/
│           ├── app/               ← Next.js App Router
│           ├── features/
│           │   ├── budgets/       ← Budget config UI + circuit reset
│           │   └── spend/         ← Live spend monitor + charts
│           └── store/             ← RTK Query slices + SSE streaming
│
└── libs/
    ├── cost-engine/               ← scope:domain  (pure DDD, zero framework deps)
    │   └── src/lib/
    │       ├── contracts.ts       ← CostSignal, CostResult, CostAdapter interfaces
    │       ├── pricing.ts         ← Additive multiplier computation (BigInt)
    │       └── adapters/
    │           ├── scraperapi.adapter.ts
    │           └── brightdata.adapter.ts
    │
    ├── budget-store/              ← scope:infra  (Redis + Lua enforcement)
    │   └── src/
    │       ├── lib/
    │       │   └── budget-store.service.ts  ← SCRIPT LOAD on bootstrap, EVALSHA calls
    │       └── lua/
    │           └── enforce.lua              ← Atomic FSM + spend debit
    │
    └── playwright-hook/           ← scope:client (publishable npm pkg)
        └── src/lib/
            ├── governor-hook.ts   ← page.route() interception
            └── errors.ts          ← GovernorDeniedError
```

**Structure Decision**: NX monorepo with `apps/` (runnable services) and `libs/` (shared
libraries). This maps directly to the constitution's scope tag taxonomy and enables
compile-time boundary enforcement. No Option 1/2/3 labels — structure is project-specific.

---

## Open-Source & npm Publishing Strategy

### Publishing Scope

| Package | npm name | Visibility | Audience |
|---------|----------|------------|----------|
| `libs/playwright-hook` | `@governor/playwright-hook` | **public** | Scraping engineers who `npm install` the SDK |
| `libs/cost-engine` | `@governor/cost-engine` | **public** | Community contributors building custom pricing adapters |
| `apps/api` | — | private (Docker image) | Internal deployment only |
| `apps/worker` | — | private (Docker image) | Internal deployment only |
| `apps/dashboard` | — | private (Docker image) | Internal deployment only |

### Release Tooling: `nx release`

**Decision**: Use NX 21's built-in `nx release` command (not Changesets).

**Rationale**:
- NX 21 is already a workspace dependency — zero additional deps.
- `nx release` natively understands NX project graph; knows which libs changed via affected.
- Supports Conventional Commits (`feat:`, `fix:`, `chore:`, `BREAKING CHANGE:`) for automatic semver bump.
- Generates per-package CHANGELOG.md entries from commit history.
- Publishes only affected packages via `nx release publish --projects=playwright-hook,cost-engine`.

**Alternatives considered**: `changesets` — good for independent versioning in large multi-team monorepos, but adds a PR-per-release workflow that is overhead for a two-package project with one version cadence.

**nx.json release config** (add to `nx.json`):
```json
{
  "release": {
    "projects": ["playwright-hook", "cost-engine"],
    "projectsRelationship": "independent",
    "changelog": {
      "projectChangelogs": true,
      "workspaceChangelog": false
    },
    "version": {
      "conventionalCommits": true,
      "generatorOptions": {
        "currentVersionResolver": "git-tag",
        "specifierSource": "conventional-commits"
      }
    },
    "releaseTagPattern": "{projectName}@{version}"
  }
}
```

### Package Configuration

#### `libs/playwright-hook/package.json`

```json
{
  "name": "@governor/playwright-hook",
  "version": "0.1.0",
  "description": "Playwright request interceptor with atomic budget enforcement via Governor API",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/YOUR_ORG/governor.git",
    "directory": "libs/playwright-hook"
  },
  "main": "./src/index.js",
  "module": "./src/index.js",
  "types": "./src/index.d.ts",
  "exports": {
    ".": {
      "types": "./src/index.d.ts",
      "default": "./src/index.js"
    }
  },
  "files": ["src", "!src/**/*.spec.*", "!src/**/__tests__"],
  "peerDependencies": {
    "@playwright/test": ">=1.40.0",
    "playwright": ">=1.40.0"
  },
  "peerDependenciesMeta": {
    "@playwright/test": { "optional": true },
    "playwright": { "optional": true }
  },
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org"
  },
  "keywords": ["playwright", "budget", "cost-control", "scraping", "governor"]
}
```

**Note**: `peerDependencies` declares Playwright without bundling it — consumers provide their own Playwright version. Both `playwright` and `@playwright/test` listed as optional peers so the hook works with either.

#### `libs/cost-engine/package.json`

```json
{
  "name": "@governor/cost-engine",
  "version": "0.1.0",
  "description": "Pure domain pricing engine for scraping cost computation — implement CostAdapter for any provider",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/YOUR_ORG/governor.git",
    "directory": "libs/cost-engine"
  },
  "main": "./src/index.js",
  "types": "./src/index.d.ts",
  "exports": {
    ".": {
      "types": "./src/index.d.ts",
      "default": "./src/index.js"
    }
  },
  "files": ["src", "!src/**/*.spec.*", "!src/**/__tests__"],
  "dependencies": {},
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org"
  },
  "keywords": ["cost-engine", "pricing", "scraping", "bigint", "governor", "adapter"]
}
```

**Note**: Zero runtime dependencies — pure TypeScript, BigInt only. Consumers get only the interfaces + `computeCostMicros` utility; framework adapters ship separately in their own services.

#### Build output path alignment

The `@nx/js:tsc` executor in both `project.json` files outputs to `dist/libs/{name}`. The `package.json` `main`/`types` paths above use `./src/` which is what NX rewrites at build time into the dist output. Verify with:
```bash
nx build playwright-hook && ls dist/libs/playwright-hook/src/
nx build cost-engine && ls dist/libs/cost-engine/src/
```

### Semantic Versioning

**Rules**:
- `MAJOR` (1.0.0): breaking change to `CostAdapter` interface, `GovernorHook.attach()` signature, or `GovernorDeniedError` shape.
- `MINOR` (0.x.0): new adapter, new optional constructor option, new exported type.
- `PATCH` (0.0.x): bug fix, documentation update, internal refactor with no API change.

**Conventional Commit prefixes** that trigger version bumps:
- `feat(playwright-hook):` → MINOR
- `fix(cost-engine):` → PATCH
- `feat!:` or `BREAKING CHANGE:` footer → MAJOR
- `chore:`, `docs:`, `test:` → no release (unless `--force`)

**Pre-release**: use `nx release version --specifier=prerelease --preid=beta` for beta tags (`0.2.0-beta.1`).

### Open-Source Governance

**Files to create at repo root**:

| File | Purpose |
|------|---------|
| `LICENSE` | MIT license, copyright `Governor Contributors` |
| `CONTRIBUTING.md` | Fork → branch → PR → constitution check → changelog entry |
| `CODE_OF_CONDUCT.md` | Contributor Covenant 2.1 |
| `SECURITY.md` | Responsible disclosure policy, contact email |
| `CHANGELOG.md` | Root changelog (generated by `nx release`) |
| `.github/PULL_REQUEST_TEMPLATE.md` | Checklist: constitution check, BigInt compliance, test coverage |

**PR template must include**:
```markdown
## Constitution Check
- [ ] I. Hot/Cold Path separation maintained
- [ ] II. No `number` type used for any monetary value
- [ ] III. Hot Path p99 < 10ms not regressed
- [ ] IV. No NX boundary violations (lint passes)
- [ ] V. Tests written before implementation (TDD)
- [ ] VI. All decisions/events emit structured logs

## For public lib changes (`@governor/*`)
- [ ] No breaking change, OR `BREAKING CHANGE:` in commit footer
- [ ] CHANGELOG entry accurate
- [ ] `peerDependencies` updated if new peer added
```

### CI/CD Pipeline

#### `.github/workflows/ci.yml` — runs on every PR

```yaml
name: CI
on:
  pull_request:
    branches: [main]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm nx affected --target=lint --base=origin/main
      - run: pnpm nx affected --target=test --base=origin/main
      - run: pnpm nx affected --target=build --base=origin/main
```

**Critical**: `pnpm nx affected` — only tests/builds changed projects. On a 2-lib PR this runs in seconds, not minutes.

#### `.github/workflows/release.yml` — runs on merge to `main`

```yaml
name: Release
on:
  push:
    branches: [main]
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write      # push git tags + CHANGELOG commits
      id-token: write      # npm provenance attestation
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0, token: '${{ secrets.GITHUB_TOKEN }}' }
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile
      - run: pnpm nx run-many --target=build --projects=playwright-hook,cost-engine
      - run: |
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git config user.name "github-actions[bot]"
          pnpm nx release --skip-publish
      - run: pnpm nx release publish
        env:
          NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}'
          NPM_CONFIG_PROVENANCE: true
```

**npm Provenance** (`NPM_CONFIG_PROVENANCE=true`): publishes a signed SLSA provenance attestation. Consumers can verify the package was built from this exact GitHub Actions run — important for security-conscious scraping teams.

### npm Token Setup

1. Create npm automation token (`npm token create --type=automation`) on `npmjs.com` under the `@governor` org scope.
2. Add as `NPM_TOKEN` GitHub Actions secret in repo settings.
3. Ensure `@governor` npm org exists or use a personal scope and update package names accordingly.

### Local Release Workflow (maintainer)

```bash
# 1. Ensure main is clean
git checkout main && git pull

# 2. Build both publishable libs
pnpm nx run-many --target=build --projects=playwright-hook,cost-engine

# 3. Dry-run to preview version bumps + changelog
pnpm nx release --dry-run

# 4. Create version bump commit + tags (no publish yet)
pnpm nx release --skip-publish

# 5. Publish to npm
pnpm nx release publish

# 6. Push tags + CHANGELOG commit
git push --follow-tags
```

### Constitution Alignment for Open-Source additions

| Principle | Open-Source Impact | Status |
|-----------|-------------------|--------|
| II. BigInt | Public package consumers MUST be warned: all monetary values are `bigint` strings in transport, never `number`. Document in README. | ✅ Addressed via package description + README |
| IV. NX Boundaries | Published packages expose only `scope:domain` and `scope:client` surfaces. No internal `scope:infra` or `scope:api` code leaks into npm output. `files` field in package.json controls this. | ✅ Enforced by `files` + boundary tags |
| V. Test-First | Any community-contributed pricing adapter (implementing `CostAdapter`) MUST include unit tests as contribution requirement. Enforced via CONTRIBUTING.md and PR template. | ✅ Captured in governance |
