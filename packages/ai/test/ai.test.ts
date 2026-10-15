import { describe, it, expect, beforeAll } from 'vitest';
import type { Revision, User, StdPart } from '@bom/domain';
import { DEFAULT_SETTINGS, applyPatch, makePatch } from '@bom/domain';
import { analyze, diffRevisions } from '@bom/engine';
import { loadHollan, loadDictionary } from '@bom/fixtures';
import {
  runOptimize, acceptChanges, MockProvider, ClaudeProvider, jsonSchemaFor, optimizePayload, draftRevisionNote, meetingAssistant, askModel,
  AiError, type AiProvider, type AiRequest, type AiTask, type AiResponse,
} from '../src';

const user: User = { id: 'u_budi', name: 'Budi Santoso', email: 'b@x', teams: ['engineering'], role: 'editor', color: '#000', locale: 'id', external: false };
let dresser: Revision;
let dict: StdPart[];
const rev = (content: Revision['content']): Revision => ({ id: 'rev1', productId: 'p1', label: 'R5', state: 'draft', notes: '', authorId: 'u', createdAt: '', updatedAt: '', parentRevisionId: null, branch: null, content, submittedHash: null, releasedAt: null, meetingIds: [] });
const opts = (r: Revision, provider: AiProvider | null) => ({ revision: r, category: 'Storage & Casegoods', subCategory: 'Dressers', settings: DEFAULT_SETTINGS, dictionary: dict, provider, user });

beforeAll(async () => {
  dresser = rev((await loadHollan()).find((p) => p.code === 'HH-CC-DRAWER-DRESSER')!.content);
  dict = (await loadDictionary()).entries;
});

/** A provider that returns whatever the test wants. */
class ScriptedProvider implements AiProvider {
  readonly name = 'scripted';
  readonly model = 'scripted';
  constructor(private fn: (req: AiRequest<AiTask>) => unknown, private delay = 0) {}
  async complete<T extends AiTask>(req: AiRequest<T>): Promise<AiResponse<T>> {
    if (this.delay) await new Promise((r) => setTimeout(r, this.delay));
    return { data: this.fn(req as AiRequest<AiTask>) as AiResponse<T>['data'], model: this.model, raw: null };
  }
}

describe('AI optimize (PRD §8)', () => {
  it('rule fixes + model explanations + a finish suggestion; low-confidence suggestions start unticked', async () => {
    const s = await runOptimize(opts(dresser, new MockProvider()));
    expect(s.explanationError).toBeNull();
    const rules = s.changes.filter((c) => c.source === 'rule');
    expect(rules.length).toBe(8);
    expect(rules.every((c) => /required by rule/.test(c.reason))).toBe(true);
    const sugg = s.changes.find((c) => c.label === 'Suggestion')!;
    expect(sugg.title).toMatch(/profil top samp/);
    expect(sugg.checked).toBe(false);
    expect(s.before.fail).toBeGreaterThan(s.afterAllAccepted.fail);
    // value pins: e.g. front width 353 → 331.5
    expect(s.changes.flatMap((c) => c.pins).some((p) => p.from === 353 && p.to === 331.5)).toBe(true);
  });

  it('drops model patches that make things worse, touch locked parts or disallowed fields', async () => {
    const front = dresser.content.parts.find((p) => p.originalName === 'panel muka laci bawah')!;
    const lockedPart = dresser.content.parts.find((p) => p.role === 'back')!;
    const locked = rev(applyPatch(dresser.content, makePatch([{ op: 'setField', partId: lockedPart.id, field: 'locked', value: true }], 'lock')).content);
    const p = new ScriptedProvider(() => ({
      explanations: [],
      mappings: [],
      suggestions: [
        { title: 'Wider fronts', reason: 'looks nicer', confidence: 'high', team: 'design', ruleId: null, assumptionKeys: [], ops: [{ op: 'setDim', partId: front.id, dim: 'L', field: null, value: 800 }] },
        { title: 'Touch locked', reason: 'x', confidence: 'high', team: 'engineering', ruleId: null, assumptionKeys: [], ops: [{ op: 'setDim', partId: lockedPart.id, dim: 'T', field: null, value: 4 }] },
        { title: 'Rename', reason: 'x', confidence: 'high', team: 'design', ruleId: null, assumptionKeys: [], ops: [{ op: 'setField', partId: front.id, dim: null, field: 'notes', value: 'ok' }] },
      ],
    }));
    const s = await runOptimize(opts(locked, p));
    expect(s.notApplied.find((n) => n.title === 'Wider fronts')?.why).toMatch(/made things worse/);
    expect(s.notApplied.find((n) => n.title === 'Touch locked')?.why).toMatch(/locked/);
    expect(s.changes.find((c) => c.title === 'Rename')?.label).toBe('Suggestion');
  });

  it('on timeout the rule fixes still show, with a note that the explanation step failed', async () => {
    const slow = new ScriptedProvider(() => ({ explanations: [], mappings: [], suggestions: [] }), 300);
    const s = await runOptimize({ ...opts(dresser, slow), settings: { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, timeoutMs: 50 } } });
    expect(s.explanationError).toMatch(/Timed out/);
    expect(s.changes.filter((c) => c.source === 'rule').length).toBe(8);
  });

  it('respects the workspace off-switch, released revisions and one run per revision', async () => {
    await expect(runOptimize({ ...opts(dresser, new MockProvider()), settings: { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, enabled: false } } })).rejects.toThrow(AiError);
    await expect(runOptimize(opts({ ...dresser, state: 'released' }, new MockProvider()))).rejects.toThrow(/read-only/);
    const slow = new MockProvider(100);
    const first = runOptimize(opts(dresser, slow));
    await expect(runOptimize(opts(dresser, slow))).rejects.toThrow(/already in progress/);
    await first;
    const rulesOnly = await runOptimize({ ...opts(dresser, new MockProvider()), settings: { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, modelPass: false } } });
    expect(rulesOnly.model).toBe('rules-only');
  });

  it('accepted changes land as one history step authored "AI optimize, accepted by …"', async () => {
    const s = await runOptimize(opts(dresser, new MockProvider()));
    const ids = s.changes.filter((c) => c.checked).map((c) => c.id);
    const r = acceptChanges(dresser, s, ids, user);
    expect(r.patch.reason).toBe('AI optimize, accepted by Budi Santoso');
    expect(r.patch.source).toBe('ai');
    expect(analyze(r.content).summary.fail).toBe(s.afterAllAccepted.fail);
  });

  it('only sends the BOM, findings and involved dictionary rows (never comments or people)', () => {
    const a = analyze(dresser.content);
    const payload = optimizePayload({ content: dresser.content, findings: a.findings, fixes: [], dictionary: dict, category: 'Storage & Casegoods', subCategory: 'Dressers' });
    const s = JSON.stringify(payload);
    expect(s).not.toMatch(/comment|email|author|thread|transcript/i);
    expect(payload.dictionary.length).toBeLessThanOrEqual(300);
    expect(payload.bom.length).toBeLessThan(dresser.content.parts.length);
  });
});

describe('other helpers', () => {
  it('drafts a revision note from the diff', async () => {
    const hollan = await loadHollan();
    const a = hollan.find((p) => p.code === 'HH-CC-NIGHT-STAND')!.content;
    const b = hollan.find((p) => p.code === 'HH-CC-NIGHT-STAND-2')!.content;
    expect(await draftRevisionNote(new MockProvider(), diffRevisions(a, b))).toMatch(/part\(s\) changed/);
  });
  it('proposes decision cards that cite the transcript, never confirmed automatically', async () => {
    const r = await meetingAssistant(new MockProvider(), 'm1', [{ id: 's1', start: 12, end: 20, speakerId: null, text: 'Kita kurangi muka laci jadi 455', partIds: [dresser.content.parts[0].id], sheetId: null }], [], dresser.content);
    expect(r.proposals[0]).toMatchObject({ status: 'proposed', source: 'ai', transcriptRef: { segmentId: 's1' } });
  });
  it('answers questions citing check results', async () => {
    const a = analyze(dresser.content);
    const front = dresser.content.parts.find((p) => p.originalName === 'panel muka laci atas')!;
    const r = await askModel(new MockProvider(), 'Why is this front red?', [front], a.findings);
    expect(r.citations.length).toBeGreaterThan(0);
  });
});

describe('Claude adapter (no network)', () => {
  it('requests structured JSON, caches the system prompt, opts into refusal fallbacks', async () => {
    let sent: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    const fake = { beta: { messages: { create: async (params: Record<string, unknown>) => ((sent = params), { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ answer: 'ok', citations: [] }) }], usage: {} }) } } };
    const p = new ClaudeProvider({ client: fake as never });
    const r = await p.complete({ task: 'ask', system: 'SYS', input: { q: 1 } });
    expect(r.data.answer).toBe('ok');
    expect(sent.model).toBe('claude-opus-5-5');
    expect(sent.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(sent.output_config.format.type).toBe('json_schema');
    expect(sent.fallbacks).toBe('default');
    expect(sent.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(sent.thinking).toEqual({ type: 'adaptive' });
  });
  it('treats refusals and invalid output as errors', async () => {
    const mk = (msg: unknown) => new ClaudeProvider({ client: { beta: { messages: { create: async () => msg } } } as never });
    await expect(mk({ stop_reason: 'refusal', content: [] }).complete({ task: 'ask', system: '', input: {} })).rejects.toMatchObject({ kind: 'refusal' });
    await expect(mk({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"answer": 1}' }] }).complete({ task: 'ask', system: '', input: {} })).rejects.toMatchObject({ kind: 'invalid-output' });
  });
  it('emits strict JSON schemas (additionalProperties: false)', () => {
    const s = jsonSchemaFor('optimize') as { additionalProperties?: boolean; properties: Record<string, unknown> };
    expect(s.additionalProperties).toBe(false);
    expect(Object.keys(s.properties)).toEqual(['explanations', 'mappings', 'suggestions']);
  });
});
