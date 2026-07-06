import { GovernorDeniedError } from './errors';

export interface GovernorHookOptions {
  apiUrl: string;
  orgId: string;
  jobId: string;
}

export interface AttachOptions {
  targetId: string;
  provider: string;
  features: string[];
}

export interface PlaywrightPage {
  route(pattern: string, handler: (route: PlaywrightRoute) => Promise<void>): Promise<void>;
}

export interface PlaywrightRoute {
  request(): { url(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
}

export class GovernorHook {
  private readonly apiUrl: string;
  private readonly orgId: string;
  private readonly jobId: string;

  constructor(options: GovernorHookOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, '');
    this.orgId = options.orgId;
    this.jobId = options.jobId;
  }

  async attach(page: PlaywrightPage, options: AttachOptions): Promise<void> {
    const { targetId, provider, features } = options;

    await page.route('**/*', async (route) => {
      const requestTimestamp = new Date().toISOString();
      const idempotencyKey = await this.deriveIdempotencyKey(
        this.jobId,
        targetId,
        provider,
        requestTimestamp,
        0,
      );

      let res: Response;
      try {
        res = await fetch(`${this.apiUrl}/v1/enforce`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId: this.orgId,
            jobId: this.jobId,
            targetId,
            provider,
            features,
            idempotencyKey,
            requestTimestamp,
            retryIndex: 0,
          }),
        });
      } catch {
        await route.abort();
        throw new GovernorDeniedError('STORE_UNAVAILABLE');
      }

      if (res.ok) {
        await route.continue();
        return;
      }

      const body = await res.json() as { state?: string };
      const state = body.state as 'OPEN' | 'NO_BUDGET' | 'STORE_UNAVAILABLE' | undefined;
      await route.abort();
      throw new GovernorDeniedError(state ?? 'STORE_UNAVAILABLE');
    });
  }

  private async deriveIdempotencyKey(
    jobId: string,
    targetId: string,
    provider: string,
    requestTimestamp: string,
    retryIndex: number,
  ): Promise<string> {
    const raw = `${jobId}:${targetId}:${provider}:${requestTimestamp}:${retryIndex}`;
    const encoded = new TextEncoder().encode(raw);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}
