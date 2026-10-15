import type { Team } from '@bom/domain';
import { DEFAULT_SETTINGS } from '@bom/domain';
import { analyze } from '@bom/engine';
import { personalSheetPdf } from '@bom/exporters';
import { route, notFound } from '@/server/http';
import { requireSession } from '@/server/auth';
import { loadRevision } from '@/server/service';

/** Personal spec sheet (PRD §9): one per participant, filtered to their team, QR per part for paper. */
export const GET = route(async (req, { params }) => {
  const { user, workspace, repo } = await requireSession(req);
  const m = await repo.getMeeting((await params).id);
  if (!m) throw notFound('Meeting');
  const sp = new URL(req.url).searchParams;
  const forId = sp.get('userId') ?? user.id;
  const person = (await repo.getUser(forId)) ?? user;
  const team = (sp.get('team') ?? m.participants.find((p) => p.userId === forId)?.team ?? person.teams[0]) as Team;
  const { revision, product } = await loadRevision(repo, m.revisionId);
  const a = analyze(revision.content, workspace.settings ?? DEFAULT_SETTINGS);
  const origin = new URL(req.url).origin;
  const bytes = await personalSheetPdf(revision.content, a.layout, { productCode: product.code, productName: product.name, revisionLabel: revision.label, revisionState: revision.state, date: new Date().toISOString().slice(0, 10), reviews: await repo.listReviews(revision.id), partLinkBase: `${origin}/p/${product.id}/r/${revision.id}/part/`, person: person.name, team });
  return new Response(Buffer.from(bytes), { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${product.code}-${revision.label}-${team}-${person.name.split(' ')[0]}.pdf"` } });
});
