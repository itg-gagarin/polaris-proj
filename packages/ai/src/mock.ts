/**
 * Deterministic stand-in for the model: same contract, no network, nothing leaves the machine.
 * Used when AI_PROVIDER is not "claude", in tests and in the demo.
 */
import { SCHEMAS, type AiTask, type AiOutput } from './schemas';
import type { AiProvider, AiRequest, AiResponse } from './provider';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export class MockProvider implements AiProvider {
  readonly name = 'mock';
  readonly model = 'mock-deterministic';
  constructor(private delayMs = 0) {}

  async complete<T extends AiTask>(req: AiRequest<T>): Promise<AiResponse<T>> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const input = req.input as Json;
    let data: unknown;
    switch (req.task) {
      case 'optimize':
        data = this.optimize(input);
        break;
      case 'import-mapping':
        data = {
          mappings: (input.unmatched ?? []).map((u: Json) => ({
            partId: u.id,
            candidates: (u.candidates ?? []).slice(0, 3).map((c: Json) => ({ stdCode: c.stdCode, role: null, axisMap: null, confidence: c.score >= 0.8 ? 'medium' : 'low', reason: `Name "${u.name}" is close to "${c.name}" (${Math.round(c.score * 100)}%)` })),
          })),
        };
        break;
      case 'revision-summary': {
        const d = input.diff as Json;
        const bullets = [
          ...(d.changed ?? []).slice(0, 12).map((c: Json) => `${c.team}: ${c.name} — ${c.changes.map((x: Json) => `${x.field} ${JSON.stringify(x.before)} → ${JSON.stringify(x.after)}`).join(', ')}`),
          ...(d.added ?? []).map((p: Json) => `added ${p.name}`),
          ...(d.removed ?? []).map((p: Json) => `removed ${p.name}`),
        ];
        data = { summary: `${(d.changed ?? []).length} part(s) changed, ${(d.added ?? []).length} added, ${(d.removed ?? []).length} removed.`, bullets };
        break;
      }
      case 'review-assistant':
        data = { summary: `${(input.changes ?? []).length} change(s) in the ${input.team} scope since the last approval.`, bullets: input.changes ?? [] };
        break;
      case 'meeting-assistant': {
        const decisions = (input.transcript ?? [])
          .filter((s: Json) => /\b(harus|ganti|kurangi|tambah|pakai|should|change|reduce|increase|use|decide|agreed|setuju)\b/i.test(s.text))
          .map((s: Json) => ({ text: s.text, partIds: s.partIds ?? [], ownerTeam: s.team ?? 'design', segmentId: s.id, confidence: 'low' }));
        data = { summary: `${(input.transcript ?? []).length} transcript segment(s), ${(input.notes ?? []).length} shared note(s); ${decisions.length} possible decision(s) proposed for confirmation.`, decisions };
        break;
      }
      case 'ask': {
        const fs = (input.findings ?? []) as Json[];
        data = {
          answer: fs.length ? fs.map((f) => `${f.rule} (${f.severity}, ${f.confidence} confidence): ${f.message}`).join('\n') : 'No check flags the selected parts.',
          citations: fs.map((f) => f.key),
        };
        break;
      }
    }
    const parsed = SCHEMAS[req.task].parse(data) as AiOutput<T>;
    return { data: parsed, model: this.model, raw: data };
  }

  private optimize(input: Json): AiOutput<'optimize'> {
    const explanations = (input.computedFixes ?? []).map((f: Json) => ({ patchId: f.patchId, reason: `${f.reason} — required by rule "${f.rule}".` }));
    const mappings = (input.unmatched ?? [])
      .filter((u: Json) => u.candidates?.[0])
      .map((u: Json) => ({ partId: u.id, stdCode: u.candidates[0].stdCode, confidence: u.candidates[0].score >= 0.8 ? 'medium' : 'low', reason: `Closest dictionary name "${u.candidates[0].name}"` }));
    // A suggestion no rule can express: give visible parts without a finish the finish used most in their assembly.
    const suggestions: AiOutput<'optimize'>['suggestions'] = [];
    for (const f of (input.findings ?? []) as Json[]) {
      if (f.rule !== 'finish-coverage') continue;
      const bom = (input.bom ?? []) as Json[];
      for (const id of f.parts) {
        const p = bom.find((b) => b.id === id);
        if (!p || p.locked) continue;
        const siblings = bom.filter((b) => b.l1 === p.l1 && b.finishCode);
        const counts = new Map<string, number>();
        for (const s of siblings) counts.set(s.finishCode, (counts.get(s.finishCode) ?? 0) + 1);
        const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (!best) continue;
        suggestions.push({ title: `Finish code for ${p.name}`, reason: `Visible part without a finish; the rest of "${p.l1}" uses ${best}. Colour & finishing must confirm.`, confidence: 'low', team: 'finishing', ruleId: null, assumptionKeys: [], ops: [{ op: 'setField', partId: id, dim: null, field: 'finishCode', value: best }] });
      }
    }
    return { explanations, mappings, suggestions };
  }
}
