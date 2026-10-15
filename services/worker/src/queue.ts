import { newId } from '@bom/domain';
import type { SqlExecutor } from '@bom/db';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Job<P = unknown> {
  id: string;
  kind: string;
  payload: P;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  lockedBy: string | null;
  result: unknown;
  error: string | null;
  dedupeKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueOptions {
  runAt?: Date;
  maxAttempts?: number;
  /** While a job with this key is queued or running, enqueueing again returns that job. */
  dedupeKey?: string;
}

/**
 * Job queue port. Memory for dev/tests; PostgreSQL (app.jobs, FOR UPDATE SKIP LOCKED) in production.
 * Payloads are scrubbed on completion (`scrub`) so uploaded workbook bytes never outlive their job.
 */
export interface JobQueue {
  enqueue<P>(kind: string, payload: P, opts?: EnqueueOptions): Promise<Job<P>>;
  claim(workerId: string, kinds?: string[]): Promise<Job | null>;
  complete(id: string, result: unknown, scrubbedPayload?: unknown): Promise<void>;
  /** Re-queues with backoff until maxAttempts, then marks failed. */
  fail(id: string, error: string, retryInMs: number, scrubbedPayload?: unknown): Promise<Job>;
  get(id: string): Promise<Job | null>;
  list(filter?: { status?: JobStatus; kind?: string; limit?: number }): Promise<Job[]>;
  /** Re-queue jobs whose worker died (running and locked longer than staleMs). */
  recoverStale(staleMs: number): Promise<number>;
}

const iso = (d = new Date()) => d.toISOString();
const copy = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export class MemoryQueue implements JobQueue {
  private jobs = new Map<string, Job & { lockedAt?: string }>();

  async enqueue<P>(kind: string, payload: P, opts: EnqueueOptions = {}): Promise<Job<P>> {
    if (opts.dedupeKey) {
      const dup = [...this.jobs.values()].find((j) => j.dedupeKey === opts.dedupeKey && (j.status === 'queued' || j.status === 'running'));
      if (dup) return copy(dup) as Job<P>;
    }
    const now = iso();
    const job: Job<P> = { id: newId('job'), kind, payload: copy(payload), status: 'queued', attempts: 0, maxAttempts: opts.maxAttempts ?? 3, runAt: iso(opts.runAt ?? new Date()), lockedBy: null, result: null, error: null, dedupeKey: opts.dedupeKey ?? null, createdAt: now, updatedAt: now };
    this.jobs.set(job.id, job as Job);
    return copy(job);
  }

  async claim(workerId: string, kinds?: string[]) {
    const now = iso();
    const next = [...this.jobs.values()]
      .filter((j) => j.status === 'queued' && j.runAt <= now && (!kinds || kinds.includes(j.kind)))
      .sort((a, b) => a.runAt.localeCompare(b.runAt) || a.createdAt.localeCompare(b.createdAt))[0];
    if (!next) return null;
    Object.assign(next, { status: 'running', attempts: next.attempts + 1, lockedBy: workerId, lockedAt: now, updatedAt: now });
    return copy(next);
  }

  async complete(id: string, result: unknown, scrubbed?: unknown) {
    const j = this.jobs.get(id);
    if (!j) return;
    Object.assign(j, { status: 'done', result: copy(result), lockedBy: null, updatedAt: iso(), ...(scrubbed !== undefined ? { payload: copy(scrubbed) } : {}) });
  }

  async fail(id: string, error: string, retryInMs: number, scrubbed?: unknown) {
    const j = this.jobs.get(id)!;
    const final = j.attempts >= j.maxAttempts;
    Object.assign(j, { status: final ? 'failed' : 'queued', error, lockedBy: null, runAt: final ? j.runAt : iso(new Date(Date.now() + retryInMs)), updatedAt: iso(), ...(final && scrubbed !== undefined ? { payload: copy(scrubbed) } : {}) });
    return copy(j);
  }

  async get(id: string) {
    return copy(this.jobs.get(id) ?? null);
  }

  async list(f: { status?: JobStatus; kind?: string; limit?: number } = {}) {
    return copy([...this.jobs.values()].filter((j) => (!f.status || j.status === f.status) && (!f.kind || j.kind === f.kind)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, f.limit ?? 100));
  }

  async recoverStale(staleMs: number) {
    const cutoff = iso(new Date(Date.now() - staleMs));
    let n = 0;
    for (const j of this.jobs.values()) if (j.status === 'running' && (j.lockedAt ?? '') < cutoff) {
      Object.assign(j, { status: 'queued', lockedBy: null, updatedAt: iso() });
      n++;
    }
    return n;
  }
}

type Row = Record<string, unknown>;
const fromRow = (r: Row): Job => {
  const t = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
  const j = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v ?? null);
  return { id: String(r.id), kind: String(r.kind), payload: j(r.payload), status: r.status as JobStatus, attempts: Number(r.attempts), maxAttempts: Number(r.max_attempts), runAt: t(r.run_at)!, lockedBy: t(r.locked_by), result: j(r.result), error: t(r.error), dedupeKey: t(r.dedupe_key), createdAt: t(r.created_at)!, updatedAt: t(r.updated_at)! };
};

/** PostgreSQL queue over app.jobs (supabase/migrations/20261015000004_jobs.sql). Runs as the service role. */
export class SqlQueue implements JobQueue {
  constructor(private db: SqlExecutor) {}

  async enqueue<P>(kind: string, payload: P, opts: EnqueueOptions = {}): Promise<Job<P>> {
    const id = newId('job');
    const r = await this.db.query<Row>(
      `insert into app.jobs (id, kind, payload, max_attempts, run_at, dedupe_key) values ($1, $2, $3, $4, $5, $6)
       on conflict (dedupe_key) where dedupe_key is not null and status in ('queued', 'running') do nothing returning *`,
      [id, kind, JSON.stringify(payload), opts.maxAttempts ?? 3, iso(opts.runAt ?? new Date()), opts.dedupeKey ?? null],
    );
    if (r.rows[0]) return fromRow(r.rows[0]) as Job<P>;
    const dup = await this.db.query<Row>(`select * from app.jobs where dedupe_key = $1 and status in ('queued', 'running') limit 1`, [opts.dedupeKey]);
    return fromRow(dup.rows[0]) as Job<P>;
  }

  async claim(workerId: string, kinds?: string[]) {
    const r = await this.db.query<Row>(
      `update app.jobs set status = 'running', attempts = attempts + 1, locked_by = $1, locked_at = now(), updated_at = now()
       where id = (select id from app.jobs where status = 'queued' and run_at <= now() ${kinds ? 'and kind = any($2)' : ''}
                   order by run_at, created_at for update skip locked limit 1)
       returning *`,
      kinds ? [workerId, kinds] : [workerId],
    );
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  }

  async complete(id: string, result: unknown, scrubbed?: unknown) {
    await this.db.query(
      `update app.jobs set status = 'done', result = $2, locked_by = null, updated_at = now() ${scrubbed !== undefined ? ', payload = $3' : ''} where id = $1`,
      scrubbed !== undefined ? [id, JSON.stringify(result ?? null), JSON.stringify(scrubbed)] : [id, JSON.stringify(result ?? null)],
    );
  }

  async fail(id: string, error: string, retryInMs: number, scrubbed?: unknown) {
    const r = await this.db.query<Row>(
      `update app.jobs set error = $2, locked_by = null, updated_at = now(),
         status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         run_at = case when attempts >= max_attempts then run_at else now() + ($3 || ' milliseconds')::interval end,
         payload = case when attempts >= max_attempts and $4::jsonb is not null then $4::jsonb else payload end
       where id = $1 returning *`,
      [id, error, String(Math.max(0, Math.round(retryInMs))), scrubbed !== undefined ? JSON.stringify(scrubbed) : null],
    );
    return fromRow(r.rows[0]);
  }

  async get(id: string) {
    const r = await this.db.query<Row>('select * from app.jobs where id = $1', [id]);
    return r.rows[0] ? fromRow(r.rows[0]) : null;
  }

  async list(f: { status?: JobStatus; kind?: string; limit?: number } = {}) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.status) where.push(`status = $${params.push(f.status)}`);
    if (f.kind) where.push(`kind = $${params.push(f.kind)}`);
    const r = await this.db.query<Row>(`select * from app.jobs ${where.length ? `where ${where.join(' and ')}` : ''} order by created_at desc limit ${Math.max(1, Math.min(1000, f.limit ?? 100))}`, params);
    return r.rows.map(fromRow);
  }

  async recoverStale(staleMs: number) {
    const r = await this.db.query<Row>(`update app.jobs set status = 'queued', locked_by = null, updated_at = now() where status = 'running' and locked_at < now() - ($1 || ' milliseconds')::interval returning id`, [String(staleMs)]);
    return r.rows.length;
  }
}
