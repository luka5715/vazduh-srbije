/**
 * Deterministic `fetch` replacement for `KosavaClientOptions.fetchImpl`.
 * Routes are matched by URL pathname; a route handler receives the parsed URL and the
 * 1-based attempt count for that URL, so retry behaviour (503 → 200) can be scripted.
 * Nothing here touches the network.
 */

export interface Reply {
  status?: number;
  /** JSON body (serialised with JSON.stringify) unless `text` is given. */
  body?: unknown;
  /** Raw text body (e.g. invalid JSON). */
  text?: string;
}

export type RouteHandler = (url: URL, attempt: number) => Reply | Promise<Reply>;

export interface FakeFetch {
  fetchImpl: typeof fetch;
  /** Every URL requested, in call order. */
  calls: string[];
  /** Number of in-flight requests observed at the same time (for concurrency assertions). */
  maxInFlight: number;
}

/**
 * @param routes map of pathname (e.g. "/api/v1/stations") → handler.
 * @param options.delayMs resolve each request after this many ms (lets concurrency build up).
 */
export function createFakeFetch(routes: Record<string, RouteHandler>, options: { delayMs?: number } = {}): FakeFetch {
  const calls: string[] = [];
  const attempts = new Map<string, number>();
  let inFlight = 0;
  const state: FakeFetch = { calls, maxInFlight: 0, fetchImpl: undefined as unknown as typeof fetch };

  state.fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    calls.push(href);
    const attempt = (attempts.get(href) ?? 0) + 1;
    attempts.set(href, attempt);
    inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, inFlight);
    try {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (init?.signal?.aborted) {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        throw error;
      }
      const handler = routes[url.pathname];
      if (!handler) return new Response('not found', { status: 404 });
      const reply = await handler(url, attempt);
      const text = reply.text ?? JSON.stringify(reply.body ?? null);
      return new Response(text, {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    } finally {
      inFlight--;
    }
  }) as typeof fetch;

  return state;
}

/** A handler that throws a network-style TypeError (what undici raises on DNS/connection failure). */
export function networkFailure(): RouteHandler {
  return () => {
    throw new TypeError('fetch failed');
  };
}
