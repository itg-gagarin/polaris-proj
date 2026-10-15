import { newId } from '@bom/domain';
import type { WebhookEvent } from '@bom/integrations';
import type { Job, JobQueue } from './queue';
import { HANDLERS, type JobDeps, type JobHandler, type ExportJob, type ImportJob, type OptimizeJob, type ErpPushJob, type DigestJob } from './jobs';

export interface WorkerOptions {
  queue: JobQueue;
  deps: Omit<JobDeps, 'queue'>;
  handlers?: Record<string, JobHandler>;
  id?: string;
  /** Per-job timeout (AI runs have their own 60 s timeout inside). */
  timeoutMs?: number;
  /** Retry backoff: base * 4^(attempt-1), capped. */
  backoffMs?: number;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

export class Worker {
  readonly id: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private handlers: Record<string, JobHandler>;

  constructor(private o: WorkerOptions) {
    this.id = o.id ?? newId('worker');
    this.handlers = o.handlers ?? HANDLERS;
  }

  private get deps(): JobDeps {
    return { ...this.o.deps, queue: this.o.queue };
  }

  /** Run one job if one is due. Returns the finished job (or null when the queue is empty). */
  async tick(): Promise<Job | null> {
    const job = await this.o.queue.claim(this.id, Object.keys(this.handlers));
    if (!job) return null;
    const log = this.o.log ?? (() => {});
    const handler = this.handlers[job.kind];
    const t0 = Date.now();
    try {
      const timeout = this.o.timeoutMs ?? 5 * 60_000;
      const out = await Promise.race([
        handler(job.payload, this.deps),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`Job timed out after ${timeout} ms`)), timeout).unref?.()),
      ]);
      await this.o.queue.complete(job.id, out.result, out.scrub);
      log('job done', { id: job.id, kind: job.kind, ms: Date.now() - t0 });
    } catch (e) {
      const base = this.o.backoffMs ?? 5_000;
      const retryIn = Math.min(base * 4 ** (job.attempts - 1), 30 * 60_000);
      // Imports carry file bytes: drop them once the job has finally failed.
      const scrub = job.kind === 'import' ? { ...(job.payload as ImportJob), bytesB64: undefined } : undefined;
      const after = await this.o.queue.fail(job.id, (e as Error).message, retryIn, scrub);
      log(after.status === 'failed' ? 'job failed' : 'job retry', { id: job.id, kind: job.kind, attempt: job.attempts, error: (e as Error).message });
    }
    return this.o.queue.get(job.id);
  }

  /** Process until nothing is due (tests, one-shot runs). */
  async drain(max = 1000): Promise<number> {
    let n = 0;
    while (n < max && (await this.tick())) n++;
    return n;
  }

  start(pollMs = 1000): void {
    this.stopped = false;
    const loop = async () => {
      if (this.stopped) return;
      try {
        await this.o.queue.recoverStale(15 * 60_000);
        while (!this.stopped && (await this.tick()));
      } catch (e) {
        (this.o.log ?? console.error)('worker loop error', { error: (e as Error).message });
      }
      if (!this.stopped) this.timer = setTimeout(loop, pollMs);
    };
    void loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

/** Typed enqueue helpers used by the API routes. */
export const jobs = {
  import: (q: JobQueue, p: ImportJob) => q.enqueue('import', p, { maxAttempts: 1 }),
  export: (q: JobQueue, p: ExportJob) => q.enqueue('export', p, { dedupeKey: `export:${p.revisionId}:${p.format}:${p.team ?? ''}` }),
  optimize: (q: JobQueue, p: OptimizeJob) => q.enqueue('ai-optimize', p, { maxAttempts: 1, dedupeKey: `ai-optimize:${p.revisionId}` }),
  digest: (q: JobQueue, p: DigestJob, day = new Date().toISOString().slice(0, 10)) => q.enqueue('digest', p, { dedupeKey: `digest:${p.workspaceId}:${day}` }),
  erpPush: (q: JobQueue, p: ErpPushJob) => q.enqueue('erp-push', p, { maxAttempts: 5, dedupeKey: `erp:${p.revisionId}` }),
  webhook: (q: JobQueue, event: WebhookEvent, subs: { id: string; events: string[]; active: boolean }[]) =>
    Promise.all(subs.filter((s) => s.active && s.events.includes(event.type)).map((s) => q.enqueue('webhook', { event, subscriptionId: s.id }, { maxAttempts: 6 }))),
};
