import { describe, it, expect } from 'vitest';
import type { Revision, Product, AppNotification } from '@bom/domain';
import { loadHollan } from '@bom/fixtures';
import { signPayload, verifySignature, deliverWebhook, createChatNotifier, erpPayload, RestErpConnector, type Fetcher } from '../src';

const capture = () => {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetcher: Fetcher = async (url, init) => (calls.push({ url, headers: init.headers, body: init.body }), { ok: true, status: 200, text: async () => '' });
  return { calls, fetcher };
};
const note: AppNotification = { id: 'n1', userId: 'u1', kind: 'lane', text: 'Rev R5 waits for the Hardware lane', link: '/revision/r1', read: false, createdAt: '' };

describe('webhooks', () => {
  it('signs and verifies payloads, rejects tampering and replays', async () => {
    const sig = await signPayload('s3cret', '{"a":1}', 1_000_000);
    expect(await verifySignature('s3cret', '{"a":1}', sig, 300, 1_000_100)).toBe(true);
    expect(await verifySignature('s3cret', '{"a":2}', sig, 300, 1_000_100)).toBe(false);
    expect(await verifySignature('s3cret', '{"a":1}', sig, 300, 1_001_000)).toBe(false);
  });
  it('delivers only to subscribers of the event', async () => {
    const { calls, fetcher } = capture();
    const res = await deliverWebhook({ type: 'revision.released', productId: 'p', productCode: 'NS', revisionId: 'r', label: 'R5', at: '' }, [
      { id: 'a', url: 'https://erp.example/hook', events: ['revision.released'], secret: 'x', active: true },
      { id: 'b', url: 'https://other.example/hook', events: ['comment.created'], secret: 'x', active: true },
    ], fetcher);
    expect(res).toHaveLength(1);
    expect(calls[0].headers['x-bomstudio-signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });
});

describe('chat notifications', () => {
  it('formats Slack, Teams and WhatsApp messages; nothing is sent when not configured', async () => {
    for (const [provider, env] of [['slack', { SLACK_WEBHOOK_URL: 'https://hooks.slack.test/x' }], ['teams', { TEAMS_WEBHOOK_URL: 'https://teams.test/x' }], ['whatsapp', { WHATSAPP_API_URL: 'https://wa.test/messages', WHATSAPP_TOKEN: 't' }]] as const) {
      const { calls, fetcher } = capture();
      const n = createChatNotifier({ CHAT_PROVIDER: provider, ...env }, fetcher);
      const r = await n.send(note, { to: '628123', baseUrl: 'https://studio.itg' });
      expect(r.ok).toBe(true);
      expect(calls[0].body).toContain('https://studio.itg/revision/r1');
    }
    expect(createChatNotifier({}).name).toBe('none');
  });
});

describe('ERP push', () => {
  it('builds a neutral item/BOM payload from released revisions only', async () => {
    const f = (await loadHollan())[0];
    const product: Product = { id: 'p', workspaceId: 'w', code: f.code, name: f.name, category: f.category, subCategory: f.subCategory, currentRevisionId: 'r', sharedWithBuyer: false, componentProductIds: [], createdAt: '' };
    const rev: Revision = { id: 'r', productId: 'p', label: 'R5', state: 'draft', notes: '', authorId: 'u', createdAt: '', updatedAt: '', parentRevisionId: null, branch: null, content: f.content, submittedHash: null, releasedAt: null, meetingIds: [] };
    expect(() => erpPayload(product, rev)).toThrow(/released/);
    const payload = erpPayload(product, { ...rev, state: 'released', releasedAt: '2026-10-15' });
    expect(payload.bom.length).toBe(payload.components.length);
    expect(payload.materials.find((m) => m.material === 'MAHOGANY')).toBeDefined();
    const { calls, fetcher } = capture();
    await new RestErpConnector('https://erp.test/bom', 'tok', fetcher).push(payload);
    expect(JSON.parse(calls[0].body).product.itemCode).toBe(f.code);
  });
});
