import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { MemoryRepository, type MemoryState } from './memory';

/**
 * Development persistence: the in-memory store snapshotted to a JSON file (debounced, atomic rename).
 * Survives restarts without a database. Not for production (single process, no RLS).
 */
export class FileRepository extends MemoryRepository {
  override readonly kind = 'file' as const;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private path: string, private debounceMs = 300) {
    super(existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as MemoryState) : undefined);
  }

  protected override changed(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.s));
    renameSync(tmp, this.path);
  }

  isEmpty(): boolean {
    return Object.keys(this.s.workspaces).length === 0;
  }
}
