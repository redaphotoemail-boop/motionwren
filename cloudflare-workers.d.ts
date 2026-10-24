interface Fetcher { fetch(input: Request | string, init?: RequestInit): Promise<Response>; }
interface D1Database { prepare(query: string): { bind(...values: unknown[]): { first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }>; run(): Promise<unknown> } }; }

declare module "cloudflare:workers" {
  type Statement = {
    bind: (...values: unknown[]) => Statement;
    first: <T = Record<string, unknown>>() => Promise<T | null>;
    all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
    run: () => Promise<unknown>;
  };
  type R2Object = { body: BodyInit; httpMetadata?: { contentType?: string }; size: number };
  export const env: {
    DB: { prepare: (query: string) => Statement };
    BUCKET: { get: (key: string) => Promise<R2Object | null>; put: (key: string, value: ArrayBuffer, options?: unknown) => Promise<unknown>; delete: (key: string) => Promise<unknown> };
  };
}
