export const dynamic = 'force-dynamic';

export default async function Gate({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="login" style={{ maxWidth: 420 }}>
      <h1 style={{ marginTop: 0 }}>Furniture BOM Studio</h1>
      <p className="muted">This preview is password-protected.</p>
      <form method="post" action="/api/gate" className="col">
        <input type="hidden" name="next" value={sp.next ?? '/'} />
        <input className="input" type="password" name="password" placeholder="Site password" autoFocus autoComplete="current-password" aria-label="Site password" />
        {sp.error && <span className="chip fail">Wrong password</span>}
        <button className="btn primary" type="submit">
          Enter
        </button>
      </form>
    </main>
  );
}
