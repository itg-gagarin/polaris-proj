import { NextResponse } from 'next/server';
import { WorkflowError } from '@bom/workflow';
import { AiError } from '@bom/ai';
import { PatchError } from '@bom/domain';

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const statusOf = (e: unknown): number => {
  if (e instanceof HttpError) return e.status;
  if (e instanceof WorkflowError) return e.code === 'forbidden' ? 403 : e.code === 'not-found' ? 404 : 409;
  if (e instanceof AiError) return e.kind === 'disabled' ? 409 : e.kind === 'timeout' ? 504 : 502;
  if (e instanceof PatchError) return 400;
  if (e instanceof Error && /immutable|read-only/i.test(e.message)) return 409;
  return 500;
};

type Handler<C> = (req: Request, ctx: C) => Promise<Response | unknown>;

/** Route wrapper: JSON in/out, typed errors to HTTP status codes. */
export function route<C = { params: Promise<Record<string, string>> }>(fn: Handler<C>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      const out = await fn(req, ctx);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      const status = statusOf(e);
      if (status >= 500) console.error(e);
      return NextResponse.json({ error: (e as Error).message }, { status });
    }
  };
}

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Expected a JSON body');
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);
