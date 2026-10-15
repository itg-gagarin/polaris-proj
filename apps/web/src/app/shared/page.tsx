import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/server/auth';
import { repoFor } from '@/server/context';
import { CommentBox } from '@/components/CommentBox';

export const dynamic = 'force-dynamic';

/** External buyers: only products shared with them, view and comment (PRD §2, §12). */
export default async function SharedPage() {
  const s = await getSession();
  if (!s) redirect('/login');
  const repo = await repoFor(s.authUid);
  const products = (await repo.listProducts(s.workspace.id)).filter((p) => !s.user.external || p.sharedWithBuyer);
  return (
    <main className="part-page" style={{ maxWidth: 900 }}>
      <h1>Shared with {s.user.name}</h1>
      {!products.length && <p className="muted">Nothing has been shared with you yet.</p>}
      {await Promise.all(
        products.map(async (p) => {
          const rev = p.currentRevisionId ? await repo.getRevision(p.currentRevisionId) : null;
          if (!rev) return null;
          const b = rev.content.header;
          return (
            <section key={p.id} className="thread">
              <h2 style={{ margin: 0 }}>{p.name}</h2>
              <p className="muted">
                {p.code} · Rev {rev.label} ({rev.state}) · {b.productSize ? `${b.productSize.W} × ${b.productSize.D} × ${b.productSize.H} mm` : ''}
              </p>
              <details>
                <summary>Parts ({rev.content.parts.length})</summary>
                <ul>
                  {rev.content.parts.slice(0, 200).map((pt) => (
                    <li key={pt.id}>
                      <Link href={`/p/${p.id}/r/${rev.id}/part/${pt.id}`}>{pt.name}</Link> — {pt.dims.T} × {pt.dims.W} × {pt.dims.L} mm × {pt.qty}
                    </li>
                  ))}
                </ul>
              </details>
              <CommentBox revisionId={rev.id} anchor={{ kind: 'revision' }} />
            </section>
          );
        }),
      )}
    </main>
  );
}
