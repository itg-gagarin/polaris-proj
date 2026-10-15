/**
 * Claude adapter (server / worker only — keys never reach the browser).
 * Structured JSON output via output_config.format, cached static system prompt,
 * adaptive thinking, refusal fallbacks enabled by default, and a hard timeout.
 */
import Anthropic from '@anthropic-ai/sdk';
import { SCHEMAS, jsonSchemaFor, type AiTask } from './schemas';
import { AiError, type AiProvider, type AiRequest, type AiResponse } from './provider';

export interface ClaudeOptions {
  apiKey?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Server-side refusal fallbacks (on by default; set false to return refusals as errors). */
  fallbacks?: boolean;
  client?: Anthropic;
}

export class ClaudeProvider implements AiProvider {
  readonly name = 'claude';
  readonly model: string;
  private client: Anthropic;
  private effort: NonNullable<ClaudeOptions['effort']>;
  private fallbacks: boolean;

  constructor(opts: ClaudeOptions = {}) {
    this.model = opts.model ?? 'claude-opus-5-5';
    this.client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.effort = opts.effort ?? 'medium';
    this.fallbacks = opts.fallbacks ?? true;
  }

  async complete<T extends AiTask>(req: AiRequest<T>): Promise<AiResponse<T>> {
    const params: Record<string, unknown> = {
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      // Static instructions first so the prefix caches across runs.
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: JSON.stringify(req.input) }],
      thinking: { type: 'adaptive' },
      output_config: { effort: this.effort, format: { type: 'json_schema', schema: jsonSchemaFor(req.task) } },
      ...(this.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    };
    let msg: Anthropic.Beta.BetaMessage;
    try {
      msg = (await this.client.beta.messages.create(params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming, { timeout: req.timeoutMs ?? 60_000, maxRetries: 1 })) as Anthropic.Beta.BetaMessage;
    } catch (err) {
      if (err instanceof Anthropic.APIConnectionTimeoutError) throw new AiError('The model did not answer in time', 'timeout');
      if (err instanceof Anthropic.APIError) throw new AiError(`Claude API ${err.status ?? ''}: ${err.message}`, 'api');
      throw err;
    }
    if (msg.stop_reason === 'refusal') throw new AiError('The model declined this request', 'refusal');
    const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AiError('The model returned invalid JSON', 'invalid-output');
    }
    const parsed = SCHEMAS[req.task].safeParse(json);
    if (!parsed.success) throw new AiError(`Output does not match the schema: ${parsed.error.message.slice(0, 200)}`, 'invalid-output');
    return { data: parsed.data as AiResponse<T>['data'], model: msg.model, raw: msg, usage: msg.usage as unknown as Record<string, number> };
  }
}
