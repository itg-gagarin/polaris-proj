import type { AiTask, AiOutput } from './schemas';

export interface AiRequest<T extends AiTask> {
  task: T;
  /** Static instructions (cached). */
  system: string;
  /** The payload (JSON) for this run. */
  input: unknown;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface AiResponse<T extends AiTask> {
  data: AiOutput<T>;
  model: string;
  raw: unknown;
  usage?: Record<string, number | null | undefined>;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'refusal' | 'invalid-output' | 'disabled' | 'api',
  ) {
    super(message);
  }
}

/** Every model call goes through this port; providers: Claude (server-side only) and a deterministic mock. */
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete<T extends AiTask>(req: AiRequest<T>): Promise<AiResponse<T>>;
}
