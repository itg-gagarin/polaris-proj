/**
 * Chat notifications (PRD §10 "later"): which app the teams use is an open question (PRD §14),
 * so all three adapters exist behind one interface and none is on by default.
 */
import type { AppNotification } from '@bom/domain';
import type { Fetcher, DeliveryResult } from './http';
import { defaultFetcher } from './http';

export interface ChatNotifier {
  readonly name: 'slack' | 'teams' | 'whatsapp' | 'none';
  send(n: AppNotification, opts?: { to?: string; baseUrl?: string }): Promise<DeliveryResult>;
}

const link = (n: AppNotification, base?: string) => (base ? `${base.replace(/\/$/, '')}${n.link}` : n.link);

export class SlackNotifier implements ChatNotifier {
  readonly name = 'slack' as const;
  constructor(private webhookUrl: string, private fetcher: Fetcher = defaultFetcher) {}
  async send(n: AppNotification, opts: { baseUrl?: string } = {}) {
    const body = JSON.stringify({ text: n.text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `${n.text}\n<${link(n, opts.baseUrl)}|Open in BOM Studio>` } }] });
    const r = await this.fetcher(this.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    return { ok: r.ok, status: r.status, target: 'slack' };
  }
}

export class TeamsNotifier implements ChatNotifier {
  readonly name = 'teams' as const;
  constructor(private webhookUrl: string, private fetcher: Fetcher = defaultFetcher) {}
  async send(n: AppNotification, opts: { baseUrl?: string } = {}) {
    const body = JSON.stringify({
      type: 'message',
      attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: { type: 'AdaptiveCard', version: '1.4', body: [{ type: 'TextBlock', text: n.text, wrap: true }], actions: [{ type: 'Action.OpenUrl', title: 'Open in BOM Studio', url: link(n, opts.baseUrl) }] } }],
    });
    const r = await this.fetcher(this.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    return { ok: r.ok, status: r.status, target: 'teams' };
  }
}

/** WhatsApp Business Cloud API style text message; the phone number comes from the member profile. */
export class WhatsAppNotifier implements ChatNotifier {
  readonly name = 'whatsapp' as const;
  constructor(private apiUrl: string, private token: string, private fetcher: Fetcher = defaultFetcher) {}
  async send(n: AppNotification, opts: { to?: string; baseUrl?: string } = {}) {
    if (!opts.to) return { ok: false, status: 0, target: 'whatsapp', error: 'no phone number on the member profile' };
    const body = JSON.stringify({ messaging_product: 'whatsapp', to: opts.to, type: 'text', text: { body: `${n.text}\n${link(n, opts.baseUrl)}` } });
    const r = await this.fetcher(this.apiUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` }, body });
    return { ok: r.ok, status: r.status, target: 'whatsapp' };
  }
}

export const noChat: ChatNotifier = { name: 'none', send: async () => ({ ok: true, status: 0, target: 'none' }) };

export function createChatNotifier(env: { CHAT_PROVIDER?: string; SLACK_WEBHOOK_URL?: string; TEAMS_WEBHOOK_URL?: string; WHATSAPP_API_URL?: string; WHATSAPP_TOKEN?: string }, fetcher?: Fetcher): ChatNotifier {
  switch (env.CHAT_PROVIDER) {
    case 'slack':
      return env.SLACK_WEBHOOK_URL ? new SlackNotifier(env.SLACK_WEBHOOK_URL, fetcher) : noChat;
    case 'teams':
      return env.TEAMS_WEBHOOK_URL ? new TeamsNotifier(env.TEAMS_WEBHOOK_URL, fetcher) : noChat;
    case 'whatsapp':
      return env.WHATSAPP_API_URL && env.WHATSAPP_TOKEN ? new WhatsAppNotifier(env.WHATSAPP_API_URL, env.WHATSAPP_TOKEN, fetcher) : noChat;
    default:
      return noChat;
  }
}
