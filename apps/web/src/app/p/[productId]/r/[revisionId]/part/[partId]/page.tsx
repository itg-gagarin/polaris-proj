import { notFound, redirect } from 'next/navigation';
import { TEAMS } from '@bom/domain';
import { getSession } from '@/server/auth';
import { repoFor } from '@/server/context';
import { CommentBox } from '@/components/CommentBox';

export const dynamic = 'force-dynamic';

/**
 * QR target on printed spec sheets (PRD §9 paper fallback): the part, its threads and a comment box.
 * Works on phones (view and comment).
 */
export default async function PartPage({ params }: { params: Promise<{ productId: string; revisionId: string; partId: string }> }) {
  const s = await getSession();
  if (!s) redirect('/login');
  const { productId, revisionId, partId } = await params;
  const repo = await repoFor(s.authUid);
  const product = await repo.getProduct(productId);
  const rev = await repo.getRevision(revisionId);
  if (!product || !rev || rev.productId !== productId) notFound();
  if (s.user.external && !product.sharedWithBuyer) notFound();
  const part = rev.content.parts.find((p) => p.id === partId);
  if (!part) notFound();
  const threads = (await repo.listThreads({ revisionId })).filter((t) => t.anchor.kind === 'part' && t.anchor.partId === partId);
  const users = new Map((await repo.listUsers(s.workspace.id)).map((u) => [u.id, u]));
  return (
    <main className="part-page">
      <p className="muted">
        {product.code} · {product.name} · Rev {rev.label} ({rev.state})
      </p>
      <h1 style={{ margin: '4px 0' }}>{part.name}</h1>
      <p className="muted">{part.originalName}</p>
      <table className="grid" style={{ maxWidth: 520 }}>
        <tbody>
          <tr><th>Std Code</th><td className="mono">{part.stdCode ?? '—'}</td></tr>
          <tr><th>Size (T × W × L)</th><td className="mono">{part.dims.T} × {part.dims.W} × {part.dims.L} mm</td></tr>
          <tr><th>Quantity</th><td>{part.qty} {part.unit}</td></tr>
          <tr><th>Material</th><td>{part.material ?? '—'}</td></tr>
          <tr><th>Finish</th><td>{part.finishCode ?? '—'}</td></tr>
          <tr><th>Hardware SKU</th><td>{part.hardwareSku ?? '—'}</td></tr>
          <tr><th>Team</th><td>{TEAMS[part.teamOwner].label.en}</td></tr>
          <tr><th>Assembly</th><td>{rev.content.assemblies.find((a) => a.id === part.assemblyId)?.name ?? '—'}</td></tr>
        </tbody>
      </table>
      <h2>Comments</h2>
      {threads.map((t) => (
        <div key={t.id} className={`thread ${t.status}`}>
          {t.comments.map((c) => (
            <div key={c.id} className="comment">
              <span className="who">{users.get(c.authorId)?.name ?? c.authorId}</span> <span className="muted">{new Date(c.createdAt).toLocaleString()}</span>
              <div>{c.body}</div>
            </div>
          ))}
        </div>
      ))}
      {!threads.length && <p className="muted">No comments on this part yet.</p>}
      <CommentBox revisionId={revisionId} anchor={{ kind: 'part', partId: part.id, stdCode: part.stdCode, position: part.position }} />
    </main>
  );
}
