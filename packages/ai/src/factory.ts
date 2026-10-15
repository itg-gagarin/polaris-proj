import type { AiProvider } from './provider';
import { ClaudeProvider } from './claude';
import { MockProvider } from './mock';

export interface AiEnv {
  AI_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  AI_MODEL?: string;
}

/** AI_PROVIDER=claude needs ANTHROPIC_API_KEY (server side). Anything else → the deterministic mock. */
export function createAiProvider(env: AiEnv = {}): AiProvider {
  if (env.AI_PROVIDER === 'claude') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('AI_PROVIDER=claude needs ANTHROPIC_API_KEY');
    return new ClaudeProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL || 'claude-opus-5-5' });
  }
  return new MockProvider();
}
