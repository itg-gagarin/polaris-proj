/** The other AI helpers (PRD §8 "later phases"): import mapping, revision note, review assistant, meeting assistant, ask. */
import type { Decision, Finding, MeetingNote, Part, RevisionContent, StdPart, Team, TranscriptSegment } from '@bom/domain';
import { newId } from '@bom/domain';
import type { RevisionDiff } from '@bom/engine';
import type { AiProvider } from './provider';
import { SYSTEM } from './prompts';
import { bomLine } from './payload';

export async function suggestImportMapping(provider: AiProvider, content: RevisionContent, dictionary: StdPart[]) {
  const unmatched = content.parts.filter((p) => p.match.status === 'unmatched' || p.match.status === 'fuzzy');
  const codes = new Set(unmatched.flatMap((p) => p.match.candidates.map((c) => c.stdCode)));
  const input = {
    unmatched: unmatched.map((p) => ({ id: p.id, name: p.originalName, l1: p.l1, position: p.position, candidates: p.match.candidates })),
    dictionary: dictionary.filter((e) => codes.has(e.stdCode)).map((e) => ({ stdCode: e.stdCode, name: e.name, l1: e.l1, mergedNames: e.mergedNames.slice(0, 6), positions: e.positions })),
  };
  return (await provider.complete({ task: 'import-mapping', system: SYSTEM['import-mapping'], input })).data;
}

/** Draft the revision note from the diff, for the author to edit. */
export async function draftRevisionNote(provider: AiProvider, diff: RevisionDiff): Promise<string> {
  const input = {
    diff: {
      changed: diff.changed.map((c) => ({ name: c.name, team: c.team, changes: c.changes.filter((x) => x.field !== 'match') })),
      added: diff.added.map((p) => ({ name: p.originalName, team: p.teamOwner })),
      removed: diff.removed.map((p) => ({ name: p.originalName, team: p.teamOwner })),
      parameters: diff.parameters,
    },
  };
  const r = (await provider.complete({ task: 'revision-summary', system: SYSTEM['revision-summary'], input })).data;
  return [r.summary, ...r.bullets.map((b) => `• ${b}`)].join('\n');
}

export async function reviewAssistant(provider: AiProvider, team: Team, changes: string[]) {
  return (await provider.complete({ task: 'review-assistant', system: SYSTEM['review-assistant'], input: { team, changes } })).data;
}

/** Proposed decision cards cite a transcript moment; a person confirms each one. */
export async function meetingAssistant(provider: AiProvider, meetingId: string, transcript: TranscriptSegment[], notes: MeetingNote[], content: RevisionContent): Promise<{ summary: string; proposals: Decision[] }> {
  const team = (ids: string[]) => content.parts.find((p) => p.id === ids[0])?.teamOwner ?? 'design';
  const input = {
    transcript: transcript.map((s) => ({ id: s.id, start: s.start, text: s.text, partIds: s.partIds, team: team(s.partIds) })),
    notes: notes.filter((n) => n.visibility === 'shared').map((n) => ({ text: n.text, tag: n.tag, team: n.team, partId: n.anchor.kind === 'part' ? n.anchor.partId : null })),
    parts: content.parts.map((p) => ({ id: p.id, name: p.originalName, team: p.teamOwner })),
  };
  const r = (await provider.complete({ task: 'meeting-assistant', system: SYSTEM['meeting-assistant'], input })).data;
  return {
    summary: r.summary,
    proposals: r.decisions.map((d) => ({
      id: newId('dec'),
      meetingId,
      text: d.text,
      partIds: d.partIds,
      ownerTeam: d.ownerTeam,
      due: null,
      status: 'proposed',
      linkedThreadId: null,
      transcriptRef: d.segmentId ? { segmentId: d.segmentId, start: transcript.find((s) => s.id === d.segmentId)?.start ?? 0 } : null,
      confirmedBy: null,
      source: 'ai',
      confidence: d.confidence,
    })),
  };
}

/** "Why is this front red?" — answers cite the check results. */
export async function askModel(provider: AiProvider, question: string, parts: Part[], findings: Finding[]) {
  const ids = new Set(parts.map((p) => p.id));
  const relevant = findings.filter((f) => f.partIds.some((id) => ids.has(id)));
  const input = { question, parts: parts.map(bomLine), findings: relevant.map((f) => ({ key: f.key, rule: f.ruleId, severity: f.severity, confidence: f.confidence, message: f.message, numbers: f.numbers })) };
  return (await provider.complete({ task: 'ask', system: SYSTEM.ask, input })).data;
}
