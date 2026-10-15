import { askModel, draftRevisionNote, reviewAssistant, suggestImportMapping } from '@bom/ai';
import type { RevisionContent, Team } from '@bom/domain';
import { can } from '@bom/domain';
import { analyze, diffRevisions } from '@bom/engine';
import { changesSinceApproval } from '@bom/workflow';
import { route, body, HttpError } from '@/server/http';
import { requireSession } from '@/server/auth';
import { getAi } from '@/server/context';
import { loadRevision } from '@/server/service';

type Req =
  | { kind: 'revisionNote'; revisionId: string }
  | { kind: 'reviewAssistant'; revisionId: string; team: Team }
  | { kind: 'ask'; revisionId: string; question: string; partIds: string[] }
  | { kind: 'importMapping'; content: RevisionContent };

/** The smaller AI helpers (PRD §8 "later phases"). All run on the same provider and log nothing sensitive. */
export const POST = route(async (req) => {
  const { user, workspace, repo } = await requireSession(req);
  if (!workspace.settings.ai.enabled) throw new HttpError(409, 'AI is turned off for this workspace');
  if (user.external) throw new HttpError(403, 'Not available to external users');
  const ai = getAi();
  const b = await body<Req>(req);
  switch (b.kind) {
    case 'revisionNote': {
      const { revision } = await loadRevision(repo, b.revisionId);
      const parent = revision.parentRevisionId ? await repo.getRevision(revision.parentRevisionId) : null;
      return { note: await draftRevisionNote(ai, diffRevisions(parent?.content ?? { ...revision.content, parts: [] }, revision.content)) };
    }
    case 'reviewAssistant': {
      const { revision } = await loadRevision(repo, b.revisionId);
      const lane = (await repo.listReviews(revision.id)).find((r) => r.team === b.team);
      const parent = revision.parentRevisionId ? await repo.getRevision(revision.parentRevisionId) : null;
      const base = parent?.content ?? revision.content;
      const changes = changesSinceApproval(b.team, base, revision.content);
      return { changes, summary: await reviewAssistant(ai, b.team, changes), lane };
    }
    case 'ask': {
      const { revision } = await loadRevision(repo, b.revisionId);
      const parts = revision.content.parts.filter((p) => b.partIds.includes(p.id));
      const findings = analyze(revision.content, workspace.settings).findings.filter((f) => f.partIds.some((id) => b.partIds.includes(id)));
      return { answer: await askModel(ai, b.question, parts, findings) };
    }
    case 'importMapping': {
      if (!can(user, 'editBom').allowed) throw new HttpError(403, 'Only editors map imports');
      return { mappings: await suggestImportMapping(ai, b.content, await repo.listStdParts()) };
    }
    default:
      throw new HttpError(400, 'Unknown helper');
  }
});
