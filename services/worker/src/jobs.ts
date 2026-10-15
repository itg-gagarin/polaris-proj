import type { Repository } from '@bom/db';
import type { AiProvider } from '@bom/ai';
import { runOptimize } from '@bom/ai';
import { exportBomWorkbook, exportJson, importFile, type ExportInput } from '@bom/bom-io';
import { DictionaryIndex } from '@bom/dictionary';
import type { AppNotification, Product, Revision, Team } from '@bom/domain';
import { DEFAULT_SETTINGS, newId, TEAM_IDS } from '@bom/domain';
import { analyze } from '@bom/engine';
import { drawingSheetPdf, dxfExport, glbExport, personalSheetPdf, stepExport } from '@bom/exporters';
import type { ChatNotifier, ErpConnector, WebhookEvent, WebhookSubscription, Fetcher } from '@bom/integrations';
import { deliverWebhook, erpPayload } from '@bom/integrations';
import { auditEvent, digest } from '@bom/workflow';
import type { JobQueue } from './queue';

export interface JobDeps {
  repo: Repository;
  queue: JobQueue;
  ai: AiProvider | null;
  chat: ChatNotifier | null;
  erp: ErpConnector | null;
  webhooks: WebhookSubscription[];
  fetcher?: Fetcher;
  baseUrl?: string;
  /** Email for digests; until an email provider is chosen, digests go to chat or the log. */
  sendEmail?: (to: string, subject: string, text: string) => Promise<void>;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

export interface JobOutcome {
  result: unknown;
  /** Replaces the stored payload when the job finishes (drop file bytes, keep what is needed to audit). */
  scrub?: unknown;
}

export type JobHandler<P = any> = (payload: P, deps: JobDeps) => Promise<JobOutcome>;

/* ------------------------------------------------------------------ */

export interface ImportJob {
  workspaceId: string;
  userId: string;
  fileName: string;
  /**
   * Workbook bytes. Password-protected workbooks are decrypted in the upload request and the
   * password is never queued; bytes are dropped from the job when it finishes.
   */
  bytesB64: string;
}

/** Parse a workbook into a preview (stored as a JSON file). Products are created only when a person confirms the preview. */
export const importJob: JobHandler<ImportJob> = async (p, { repo }) => {
  const dict = new DictionaryIndex(await repo.listStdParts());
  const res = await importFile(new Uint8Array(Buffer.from(p.bytesB64, 'base64')), p.fileName, { dictionary: dict });
  const preview = {
    fileName: p.fileName,
    workbookNotes: res.workbookNotes,
    skippedSheets: res.skippedSheets,
    products: res.products.map((x) => ({ sheet: x.sheet, format: x.format, product: x.product, revisionLabel: x.revisionLabel, content: x.content, preview: x.preview, warnings: x.warnings })),
  };
  const file = await repo.putFile(`import-preview-${p.fileName}.json`, new TextEncoder().encode(JSON.stringify(preview)), 'application/json');
  const lines = res.products.reduce((n, x) => n + x.preview.length, 0);
  const needsReview = res.products.reduce((n, x) => n + x.preview.filter((r) => r.match.status === 'fuzzy' || r.match.status === 'ai' || r.match.status === 'unmatched').length, 0);
  return { result: { previewUri: file.uri, products: res.products.length, lines, needsReview, skipped: res.skippedSheets.length }, scrub: { workspaceId: p.workspaceId, userId: p.userId, fileName: p.fileName } };
};

/* ------------------------------------------------------------------ */

export type ExportFormat = 'xlsx' | 'json' | 'pdf' | 'personal-pdf' | 'glb' | 'dxf' | 'step';

export interface ExportJob {
  revisionId: string;
  format: ExportFormat;
  userId: string;
  /** personal-pdf only. */
  team?: Team;
}

async function loadRev(repo: Repository, revisionId: string): Promise<{ rev: Revision; product: Product }> {
  const rev = await repo.getRevision(revisionId);
  if (!rev) throw new Error(`Unknown revision ${revisionId}`);
  const product = await repo.getProduct(rev.productId);
  if (!product) throw new Error(`Unknown product ${rev.productId}`);
  return { rev, product };
}

const MIME: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json',
  pdf: 'application/pdf',
  'personal-pdf': 'application/pdf',
  glb: 'model/gltf-binary',
  dxf: 'image/vnd.dxf',
  step: 'model/step',
};
const EXT: Record<ExportFormat, string> = { xlsx: 'xlsx', json: 'json', pdf: 'pdf', 'personal-pdf': 'pdf', glb: 'glb', dxf: 'dxf', step: 'step' };

export const exportJob: JobHandler<ExportJob> = async (p, { repo, baseUrl }) => {
  const { rev, product } = await loadRev(repo, p.revisionId);
  const ws = await repo.getWorkspace(product.workspaceId);
  const a = analyze(rev.content, ws?.settings ?? DEFAULT_SETTINGS);
  const input: ExportInput = { productCode: product.code, productName: product.name, category: product.category, subCategory: product.subCategory, revisionLabel: rev.label, revisionState: rev.state, content: rev.content };
  const author = (await repo.getUser(rev.authorId))?.name;
  const info = { productCode: product.code, productName: product.name, revisionLabel: rev.label, revisionState: rev.state, date: rev.updatedAt.slice(0, 10), reviews: await repo.listReviews(rev.id), author, partLinkBase: baseUrl ? `${baseUrl}/p/${product.id}/r/${rev.id}/part/` : undefined };
  let bytes: Uint8Array;
  switch (p.format) {
    case 'xlsx': bytes = await exportBomWorkbook(input); break;
    case 'json': bytes = new TextEncoder().encode(exportJson(input)); break;
    case 'pdf': bytes = await drawingSheetPdf(rev.content, a.layout, info, { findings: a.findings }); break;
    case 'personal-pdf': {
      const team = p.team ?? 'design';
      if (!TEAM_IDS.includes(team)) throw new Error(`Unknown team ${team}`);
      const person = (await repo.getUser(p.userId))?.name ?? p.userId;
      bytes = await personalSheetPdf(rev.content, a.layout, { ...info, person, team });
      break;
    }
    case 'glb': bytes = glbExport(rev.content, a.layout, { name: product.name }); break;
    case 'dxf': bytes = new TextEncoder().encode(dxfExport(rev.content, a.layout, { title: `${product.code} ${rev.label}` })); break;
    case 'step': bytes = new TextEncoder().encode(stepExport(rev.content, a.layout, { name: product.name, code: product.code })); break;
    default: throw new Error(`Unknown export format ${String(p.format)}`);
  }
  const f = await repo.putFile(`${product.code}-${rev.label}${p.format === 'personal-pdf' ? `-${p.team ?? 'design'}` : ''}.${EXT[p.format]}`, bytes, MIME[p.format]);
  return { result: { uri: f.uri, name: f.name, size: f.size } };
};

/* ------------------------------------------------------------------ */

export interface OptimizeJob {
  revisionId: string;
  userId: string;
}

/** AI optimize as a background run (PRD §12): the suggestion is stored, never applied without a person. */
export const optimizeJob: JobHandler<OptimizeJob> = async (p, { repo, ai }) => {
  const { rev, product } = await loadRev(repo, p.revisionId);
  const ws = await repo.getWorkspace(product.workspaceId);
  const user = await repo.getUser(p.userId);
  if (!user) throw new Error(`Unknown user ${p.userId}`);
  const s = await runOptimize({
    revision: rev,
    category: product.category,
    subCategory: product.subCategory,
    settings: ws?.settings ?? DEFAULT_SETTINGS,
    dictionary: await repo.listStdParts(),
    provider: ai,
    user,
    onLog: (l) => void repo.appendAiRun({ id: newId('airun'), workspaceId: product.workspaceId, revisionId: rev.id, kind: 'optimize', userId: user.id, model: l.model, request: l.request, response: l.response, status: l.status, ms: l.ms, at: new Date().toISOString() }),
  });
  const f = await repo.putFile(`ai-suggestion-${rev.id}-${s.id}.json`, new TextEncoder().encode(JSON.stringify(s)), 'application/json');
  await repo.addNotifications([{ id: newId('ntf'), userId: user.id, kind: 'ai', text: `AI optimize finished for ${product.code} ${rev.label}: ${s.changes.length} suggested change(s)`, link: `/p/${product.id}/r/${rev.id}?suggestion=${s.id}`, read: false, createdAt: new Date().toISOString() }]);
  return { result: { suggestionUri: f.uri, suggestionId: s.id, changes: s.changes.length, notApplied: s.notApplied.length, before: s.before, afterAllAccepted: s.afterAllAccepted } };
};

/* ------------------------------------------------------------------ */

export interface DigestJob {
  workspaceId: string;
}

/** Daily digest (PRD §10): one message per member with unread notifications. */
export const digestJob: JobHandler<DigestJob> = async (p, { repo, chat, sendEmail, baseUrl, log }) => {
  const users = await repo.listUsers(p.workspaceId);
  let sent = 0;
  for (const u of users) {
    const items = await repo.listNotifications(u.id);
    const text = digest(u, items);
    if (!text) continue;
    if (sendEmail) await sendEmail(u.email, 'Your BOM Studio updates', text);
    if (chat) {
      const n: AppNotification = { id: newId('ntf'), userId: u.id, kind: 'revision', text, link: '/inbox', read: false, createdAt: new Date().toISOString() };
      await chat.send(n, { baseUrl });
    }
    if (!sendEmail && !chat) log?.('digest', { user: u.id, unread: items.filter((i) => !i.read).length });
    sent++;
  }
  return { result: { sent } };
};

/* ------------------------------------------------------------------ */

export interface ErpPushJob {
  revisionId: string;
}

/** Push a released revision to the ERP (PRD §10). Only released revisions ever leave the tool. */
export const erpPushJob: JobHandler<ErpPushJob> = async (p, { repo, erp }) => {
  if (!erp) return { result: { skipped: 'ERP_PROVIDER=none' } };
  const { rev, product } = await loadRev(repo, p.revisionId);
  const payload = erpPayload(product, rev);
  const r = await erp.push(payload);
  if (!r.ok) throw new Error(`ERP push failed (${r.status}) ${r.error ?? ''}`.trim());
  await repo.appendAudit([auditEvent({ workspaceId: product.workspaceId, productId: product.id, revisionId: rev.id, who: 'system', what: `Pushed ${product.code} ${rev.label} to ERP (${erp.name})`, before: null, after: { lines: payload.bom.length, target: r.target }, source: 'system' })]);
  return { result: { ok: true, target: r.target, lines: payload.bom.length } };
};

/* ------------------------------------------------------------------ */

export interface WebhookJob {
  event: WebhookEvent;
  /** One job per subscription, so a retry never re-delivers to endpoints that already succeeded. */
  subscriptionId: string;
}

export const webhookJob: JobHandler<WebhookJob> = async (p, { webhooks, fetcher }) => {
  const res = await deliverWebhook(p.event, webhooks.filter((w) => w.id === p.subscriptionId), fetcher);
  const failed = res.filter((r) => !r.ok);
  if (failed.length) throw new Error(`Webhook delivery failed for ${failed.map((f) => f.target).join(', ')}`);
  return { result: { delivered: res.length } };
};

export const HANDLERS: Record<string, JobHandler> = {
  import: importJob,
  export: exportJob,
  'ai-optimize': optimizeJob,
  digest: digestJob,
  'erp-push': erpPushJob,
  webhook: webhookJob,
};
