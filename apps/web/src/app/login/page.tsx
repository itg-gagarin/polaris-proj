'use client';
import { useEffect, useState } from 'react';
import type { User } from '@bom/domain';
import { TEAMS } from '@bom/domain';

export default function Login() {
  const [users, setUsers] = useState<User[]>([]);
  const [provider, setProvider] = useState('dev');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    void fetch('/api/session').then(async (r) => {
      const j = (await r.json()) as { users: User[]; authProvider: string };
      setUsers(j.users);
      setProvider(j.authProvider);
    });
  }, []);
  const pick = async (id: string) => {
    setBusy(id);
    await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: id }) });
    location.href = '/';
  };
  return (
    <main className="login">
      <h1 style={{ marginTop: 0 }}>Furniture BOM Studio</h1>
      <p className="muted">Sign in (development). Pick a demo user from PT Integra Indocabinet. Production uses Supabase email and Google/Microsoft SSO.</p>
      {provider !== 'dev' && <p>Dev sign-in is off (AUTH_PROVIDER={provider}).</p>}
      {!users.length && <p className="muted">Loading the demo workspace (first start imports the Hollan House fixtures, a few seconds)…</p>}
      <div className="userpick">
        {users.map((u) => (
          <button key={u.id} onClick={() => pick(u.id)} disabled={!!busy || provider !== 'dev'} data-testid={`login-${u.id}`}>
            <div className="row">
              <span className="avatar" style={{ background: u.color, marginLeft: 0 }}>{u.name.split(' ').map((x) => x[0]).join('').slice(0, 2)}</span>
              <div>
                <div style={{ fontWeight: 600 }}>{u.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {u.role}
                  {u.external ? ' · external' : ''} · {u.teams.map((t) => TEAMS[t].label.en).join(', ')}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </main>
  );
}
