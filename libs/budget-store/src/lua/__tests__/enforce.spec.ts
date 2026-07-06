import { readFileSync } from 'fs';
import { join } from 'path';
import Redis from 'ioredis-mock';

const LUA_SCRIPT = readFileSync(
  join(__dirname, '../../lua/enforce.lua'),
  'utf8',
);

// Keys for a fixed test budget scope
const KEYS = [
  'budget:{org1:budget-abc}:state',
  'budget:{org1:budget-abc}:spend',
  'budget:{org1:budget-abc}:cap',
  'budget:{org1:budget-abc}:ttl_exp',
];

const NOW = 1_700_000_000; // fixed unix timestamp for determinism
const TTL = 60;

type EnforceResult = [allowed: number, state: string, spend: string, remaining: string];

async function callEnforce(
  client: Redis,
  costMicros: number,
  now = NOW,
  ttl = TTL,
): Promise<EnforceResult> {
  const result = await (client as any).eval(
    LUA_SCRIPT,
    4,
    ...KEYS,
    String(costMicros),
    String(now),
    String(ttl),
  );
  return result as EnforceResult;
}

async function setCapAndState(
  client: Redis,
  capMicros: number,
  state = 'CLOSED',
  spendMicros = 0,
  ttlExp?: number,
) {
  await client.set(KEYS[2], String(capMicros));
  await client.set(KEYS[0], state);
  await client.set(KEYS[1], String(spendMicros));
  if (ttlExp !== undefined) {
    await client.set(KEYS[3], String(ttlExp));
  }
}

describe('enforce.lua', () => {
  let client: Redis;

  beforeEach(async () => {
    client = new Redis();
    // clear all test keys
    await Promise.all(KEYS.map((k) => client.del(k)));
  });

  afterEach(async () => {
    await client.quit();
  });

  // ── NO_BUDGET ──────────────────────────────────────────────────────────────

  describe('NO_BUDGET', () => {
    it('denies when cap key is absent', async () => {
      const [allowed, state, spend, remaining] = await callEnforce(client, 500_000);
      expect(allowed).toBe(0);
      expect(state).toBe('NO_BUDGET');
      expect(spend).toBe('0');
      expect(remaining).toBe('0');
    });

    it('does not increment spend when no budget', async () => {
      await callEnforce(client, 500_000);
      const spendVal = await client.get(KEYS[1]);
      expect(spendVal).toBeNull();
    });
  });

  // ── CLOSED → ALLOWED ───────────────────────────────────────────────────────

  describe('CLOSED state', () => {
    it('allows request when spend is under cap', async () => {
      await setCapAndState(client, 1_000_000, 'CLOSED', 0);
      const [allowed, state, spend, remaining] = await callEnforce(client, 400_000);
      expect(allowed).toBe(1);
      expect(state).toBe('ALLOWED');
      expect(spend).toBe('400000');
      expect(remaining).toBe('600000');
    });

    it('debits spend atomically on allow', async () => {
      await setCapAndState(client, 1_000_000, 'CLOSED', 600_000);
      await callEnforce(client, 200_000);
      const stored = await client.get(KEYS[1]);
      expect(stored).toBe('800000');
    });

    it('state remains CLOSED after allowed request', async () => {
      await setCapAndState(client, 1_000_000, 'CLOSED', 0);
      await callEnforce(client, 300_000);
      const stateVal = await client.get(KEYS[0]);
      expect(stateVal).toBe('CLOSED');
    });
  });

  // ── CLOSED → TRIPPED (OPEN) ────────────────────────────────────────────────

  describe('CLOSED → OPEN (budget exhausted)', () => {
    it('trips to OPEN when spend reaches cap', async () => {
      await setCapAndState(client, 1_000_000, 'CLOSED', 600_000);
      const [allowed, state] = await callEnforce(client, 400_000);
      expect(allowed).toBe(0);
      expect(state).toBe('TRIPPED');
    });

    it('sets state key to OPEN on trip', async () => {
      await setCapAndState(client, 1_000_000, 'CLOSED', 600_000);
      await callEnforce(client, 400_000);
      const stateVal = await client.get(KEYS[0]);
      expect(stateVal).toBe('OPEN');
    });

    it('sets TTL expiry key on trip', async () => {
      await setCapAndState(client, 1_000_000, 'CLOSED', 600_000);
      await callEnforce(client, 400_000, NOW, TTL);
      const ttlVal = await client.get(KEYS[3]);
      expect(ttlVal).toBe(String(NOW + TTL));
    });

    it('trips when single request pushes spend past cap (over-debit)', async () => {
      await setCapAndState(client, 1_000_000, 'CLOSED', 800_000);
      const [allowed, state, spend] = await callEnforce(client, 400_000);
      expect(allowed).toBe(0);
      expect(state).toBe('TRIPPED');
      expect(Number(spend)).toBeGreaterThanOrEqual(1_000_000);
    });
  });

  // ── OPEN → DENIED (within TTL) ────────────────────────────────────────────

  describe('OPEN state within TTL', () => {
    it('denies without debit when circuit is OPEN and TTL not expired', async () => {
      await setCapAndState(client, 1_000_000, 'OPEN', 1_000_000, NOW + 30);
      const [allowed, state] = await callEnforce(client, 100_000, NOW);
      expect(allowed).toBe(0);
      expect(state).toBe('OPEN');
    });

    it('does not increment spend when OPEN and TTL active', async () => {
      await setCapAndState(client, 1_000_000, 'OPEN', 1_000_000, NOW + 30);
      await callEnforce(client, 100_000, NOW);
      const stored = await client.get(KEYS[1]);
      expect(stored).toBe('1000000'); // unchanged
    });
  });

  // ── OPEN → HALF_OPEN (TTL expired) ────────────────────────────────────────

  describe('OPEN → HALF_OPEN probe', () => {
    it('transitions to HALF_OPEN when TTL expires and budget has headroom', async () => {
      // spend reset or cap increased so probe passes
      await setCapAndState(client, 2_000_000, 'OPEN', 1_000_000, NOW - 1);
      const [allowed, state] = await callEnforce(client, 100_000, NOW);
      expect(allowed).toBe(1);
      expect(state).toBe('ALLOWED');
      const stateVal = await client.get(KEYS[0]);
      expect(stateVal).toBe('CLOSED');
    });

    it('returns OPEN if probe request still exhausts budget', async () => {
      await setCapAndState(client, 1_000_000, 'OPEN', 950_000, NOW - 1);
      const [allowed, state] = await callEnforce(client, 100_000, NOW);
      expect(allowed).toBe(0);
      expect(state).toBe('TRIPPED');
      const stateVal = await client.get(KEYS[0]);
      expect(stateVal).toBe('OPEN');
    });

    it('sets state to CLOSED after successful HALF_OPEN probe', async () => {
      await setCapAndState(client, 1_000_000, 'OPEN', 0, NOW - 1);
      await callEnforce(client, 100_000, NOW);
      const stateVal = await client.get(KEYS[0]);
      expect(stateVal).toBe('CLOSED');
    });
  });

  // ── Concurrent debit correctness ───────────────────────────────────────────

  describe('atomic debit under concurrent calls', () => {
    it('final spend equals sum of all individual costs', async () => {
      await setCapAndState(client, 10_000_000, 'CLOSED', 0);
      const costs = [100_000, 200_000, 300_000, 50_000, 150_000];
      await Promise.all(costs.map((c) => callEnforce(client, c)));
      const finalSpend = await client.get(KEYS[1]);
      const expectedTotal = costs.reduce((a, b) => a + b, 0);
      expect(Number(finalSpend)).toBe(expectedTotal);
    });
  });
});
