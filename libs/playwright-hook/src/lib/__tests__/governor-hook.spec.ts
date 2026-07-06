import { GovernorHook } from '../governor-hook';
import { GovernorDeniedError } from '../errors';

const mockFetch = jest.fn();
global.fetch = mockFetch;

// crypto.subtle.digest available in Node 19+; polyfill for test env
if (!global.crypto) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { webcrypto } = require('crypto');
  (global as unknown as { crypto: typeof webcrypto }).crypto = webcrypto;
}

function makeRoute(url = 'https://example.com/page') {
  const aborted = { value: false };
  const continued = { value: false };
  return {
    request: () => ({ url: () => url }),
    abort: jest.fn(async () => { aborted.value = true; }),
    continue: jest.fn(async () => { continued.value = true; }),
    _aborted: aborted,
    _continued: continued,
  };
}

function makePage() {
  let capturedHandler: ((route: ReturnType<typeof makeRoute>) => Promise<void>) | null = null;
  return {
    route: jest.fn(async (_pattern: string, handler: typeof capturedHandler) => {
      capturedHandler = handler;
    }),
    triggerRoute: async (route: ReturnType<typeof makeRoute>) => {
      if (!capturedHandler) throw new Error('No route handler attached');
      await capturedHandler(route);
    },
  };
}

describe('GovernorHook', () => {
  const hook = new GovernorHook({
    apiUrl: 'http://localhost:3000',
    orgId: 'org-1',
    jobId: 'job-1',
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('attach', () => {
    it('registers route handler on page', async () => {
      const page = makePage();
      await hook.attach(page, { targetId: 't1', provider: 'scraperapi', features: [] });
      expect(page.route).toHaveBeenCalledWith('**/*', expect.any(Function));
    });
  });

  describe('ALLOWED decision', () => {
    it('calls continue on 200 response', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const page = makePage();
      await hook.attach(page, { targetId: 't1', provider: 'scraperapi', features: [] });

      const route = makeRoute();
      await page.triggerRoute(route);

      expect(route.continue).toHaveBeenCalledTimes(1);
      expect(route.abort).not.toHaveBeenCalled();
    });

    it('sends correct body to /v1/enforce', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const page = makePage();
      await hook.attach(page, { targetId: 'tgt', provider: 'scraperapi', features: ['jsRender'] });
      await page.triggerRoute(makeRoute());

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:3000/v1/enforce');
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body as string);
      expect(body.orgId).toBe('org-1');
      expect(body.jobId).toBe('job-1');
      expect(body.targetId).toBe('tgt');
      expect(body.provider).toBe('scraperapi');
      expect(body.features).toEqual(['jsRender']);
      expect(body.retryIndex).toBe(0);
      expect(typeof body.idempotencyKey).toBe('string');
      expect(body.idempotencyKey).toHaveLength(64); // SHA-256 hex
    });

    it('strips trailing slash from apiUrl', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const hookWithSlash = new GovernorHook({
        apiUrl: 'http://localhost:3000/',
        orgId: 'org-1',
        jobId: 'job-1',
      });
      const page = makePage();
      await hookWithSlash.attach(page, { targetId: 't', provider: 'p', features: [] });
      await page.triggerRoute(makeRoute());

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:3000/v1/enforce');
    });
  });

  describe('DENIED decisions', () => {
    it('aborts route and throws GovernorDeniedError on OPEN state', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ decision: 'DENIED', state: 'OPEN' }),
      });
      const page = makePage();
      await hook.attach(page, { targetId: 't1', provider: 'scraperapi', features: [] });
      const route = makeRoute();

      await expect(page.triggerRoute(route)).rejects.toThrow(GovernorDeniedError);
      await expect(page.triggerRoute(makeRoute())).rejects.toMatchObject({ state: 'OPEN' });
      expect(route.abort).toHaveBeenCalled();
      expect(route.continue).not.toHaveBeenCalled();
    });

    it('throws GovernorDeniedError with NO_BUDGET state', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ state: 'NO_BUDGET' }),
      });
      const page = makePage();
      await hook.attach(page, { targetId: 't1', provider: 'scraperapi', features: [] });

      await expect(page.triggerRoute(makeRoute())).rejects.toMatchObject({ state: 'NO_BUDGET' });
    });

    it('falls back to STORE_UNAVAILABLE when state missing in body', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({}),
      });
      const page = makePage();
      await hook.attach(page, { targetId: 't1', provider: 'scraperapi', features: [] });

      await expect(page.triggerRoute(makeRoute())).rejects.toMatchObject({ state: 'STORE_UNAVAILABLE' });
    });
  });

  describe('fetch failure (STORE_UNAVAILABLE)', () => {
    it('aborts route and throws GovernorDeniedError when fetch throws', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      const page = makePage();
      await hook.attach(page, { targetId: 't1', provider: 'scraperapi', features: [] });
      const route = makeRoute();

      await expect(page.triggerRoute(route)).rejects.toThrow(GovernorDeniedError);
      await expect(page.triggerRoute(makeRoute())).rejects.toMatchObject({ state: 'STORE_UNAVAILABLE' });
      expect(route.abort).toHaveBeenCalled();
    });
  });

  describe('idempotency key', () => {
    it('generates different keys for different jobs', async () => {
      const calls: string[] = [];
      mockFetch.mockImplementation(async (_url: string, opts: RequestInit) => {
        calls.push(JSON.parse(opts.body as string).idempotencyKey as string);
        return { ok: true };
      });

      const hookA = new GovernorHook({ apiUrl: 'http://localhost:3000', orgId: 'org-1', jobId: 'job-A' });
      const hookB = new GovernorHook({ apiUrl: 'http://localhost:3000', orgId: 'org-1', jobId: 'job-B' });

      const pageA = makePage();
      const pageB = makePage();
      await hookA.attach(pageA, { targetId: 't', provider: 'p', features: [] });
      await hookB.attach(pageB, { targetId: 't', provider: 'p', features: [] });

      await pageA.triggerRoute(makeRoute());
      await pageB.triggerRoute(makeRoute());

      expect(calls[0]).not.toBe(calls[1]);
    });
  });

  describe('GovernorDeniedError', () => {
    it('has correct name and message', () => {
      const err = new GovernorDeniedError('OPEN', 'budget-uuid');
      expect(err.name).toBe('GovernorDeniedError');
      expect(err.message).toContain('OPEN');
      expect(err.message).toContain('budget-uuid');
      expect(err.state).toBe('OPEN');
      expect(err.budgetId).toBe('budget-uuid');
    });

    it('works without budgetId', () => {
      const err = new GovernorDeniedError('NO_BUDGET');
      expect(err.budgetId).toBeUndefined();
      expect(err.message).not.toContain('budgetId');
    });

    it('is instanceof Error', () => {
      expect(new GovernorDeniedError('OPEN')).toBeInstanceOf(Error);
    });
  });
});
