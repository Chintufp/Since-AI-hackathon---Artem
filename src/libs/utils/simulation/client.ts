/** Minimal HTTP client for the running service (JSON in, JSON out; errors carry the service message). */
export interface ServiceClient {
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body: unknown): Promise<T>;
}

export class ServiceHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function httpClient(baseUrl: string, fetchImpl: typeof fetch = fetch): ServiceClient {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetchImpl(baseUrl + path, {
      method,
      ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text.slice(0, 200) };
    }
    if (!res.ok) throw new ServiceHttpError(res.status, (json as { error?: string }).error ?? `${method} ${path} -> ${res.status}`);
    return json as T;
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b) };
}
