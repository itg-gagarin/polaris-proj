/** Outbound HTTP is injected so adapters are testable and nothing is sent unless configured. */
export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export const defaultFetcher: Fetcher = (url, init) => fetch(url, init);

export interface DeliveryResult {
  ok: boolean;
  status: number;
  target: string;
  error?: string;
}
