import type { Repository } from '@bom/db';
import { pgExecutor } from '@bom/db';
import { createAiProvider } from '@bom/ai';
import { createChatNotifier, FileErpConnector, RestErpConnector, type ErpConnector, type ErpPayload, type WebhookSubscription } from '@bom/integrations';
import { MemoryQueue, SqlQueue, type JobQueue } from './queue';
import type { JobDeps } from './jobs';

export interface WorkerEnv {
  QUEUE_BACKEND?: string;
  DATABASE_URL?: string;
  AI_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  AI_MODEL?: string;
  ERP_PROVIDER?: string;
  ERP_URL?: string;
  ERP_TOKEN?: string;
  CHAT_PROVIDER?: string;
  SLACK_WEBHOOK_URL?: string;
  TEAMS_WEBHOOK_URL?: string;
  WHATSAPP_API_URL?: string;
  WHATSAPP_TOKEN?: string;
  WEBHOOK_SUBSCRIPTIONS?: string;
  APP_BASE_URL?: string;
}

export async function createQueue(env: WorkerEnv): Promise<JobQueue> {
  const b = env.QUEUE_BACKEND ?? 'memory';
  if (b === 'postgres' || b === 'supabase') {
    if (!env.DATABASE_URL) throw new Error('QUEUE_BACKEND=postgres needs DATABASE_URL');
    return new SqlQueue(await pgExecutor(env.DATABASE_URL));
  }
  return new MemoryQueue();
}

/** Until the ERP is chosen (PRD §14), payloads are stored as files the ERP team can import. */
class RepoFileErpConnector implements ErpConnector {
  readonly name = 'file';
  constructor(private repo: Repository) {}
  async push(payload: ErpPayload) {
    const f = await this.repo.putFile(`erp-${payload.product.itemCode}-${payload.revision.label}.json`, new TextEncoder().encode(JSON.stringify(payload, null, 2)), 'application/json');
    return { ok: true, status: 200, target: f.uri };
  }
}

export function createErpConnector(env: WorkerEnv, repo: Repository): ErpConnector | null {
  switch (env.ERP_PROVIDER ?? 'none') {
    case 'rest':
      if (!env.ERP_URL || !env.ERP_TOKEN) throw new Error('ERP_PROVIDER=rest needs ERP_URL and ERP_TOKEN');
      return new RestErpConnector(env.ERP_URL, env.ERP_TOKEN);
    case 'file':
      return new RepoFileErpConnector(repo);
    case 'memory':
      return new FileErpConnector();
    default:
      return null;
  }
}

export function parseWebhookSubscriptions(raw: string | undefined): WebhookSubscription[] {
  if (!raw?.trim()) return [];
  const v = JSON.parse(raw) as WebhookSubscription[];
  if (!Array.isArray(v)) throw new Error('WEBHOOK_SUBSCRIPTIONS must be a JSON array');
  for (const s of v) if (!s.id || !s.url || !s.secret || !Array.isArray(s.events)) throw new Error('Each webhook subscription needs id, url, secret and events');
  return v;
}

export function createDeps(env: WorkerEnv, repo: Repository): Omit<JobDeps, 'queue'> {
  return {
    repo,
    ai: createAiProvider(env),
    chat: (env.CHAT_PROVIDER ?? 'none') === 'none' ? null : createChatNotifier(env),
    erp: createErpConnector(env, repo),
    webhooks: parseWebhookSubscriptions(env.WEBHOOK_SUBSCRIPTIONS),
    baseUrl: env.APP_BASE_URL,
  };
}
