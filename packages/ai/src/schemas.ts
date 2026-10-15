/** Structured outputs: the model returns JSON only, validated here before anything touches the BOM. */
import { z } from 'zod';
import { TEAM_IDS } from '@bom/domain';

const confidence = z.enum(['high', 'medium', 'low']);
const team = z.enum(TEAM_IDS);

/** The only edits the model may propose: sizes, quantities and a few safe fields (never transforms, never deletes). */
export const AiOp = z.strictObject({
  op: z.enum(['setDim', 'setQty', 'setField']),
  partId: z.string(),
  dim: z.enum(['T', 'W', 'L']).nullable(),
  field: z.enum(['material', 'finishCode', 'hardwareSku', 'notes', 'position']).nullable(),
  value: z.union([z.number(), z.string()]),
});
export type AiOp = z.infer<typeof AiOp>;

export const OptimizeOutput = z.strictObject({
  /** Plain-language reason per deterministic change (keyed by the patch id we sent). */
  explanations: z.array(z.strictObject({ patchId: z.string(), reason: z.string() })),
  /** Name → Std Code mappings for unmatched parts. */
  mappings: z.array(z.strictObject({ partId: z.string(), stdCode: z.string(), confidence, reason: z.string() })),
  /** Extra suggestions the rules can't express. */
  suggestions: z.array(
    z.strictObject({
      title: z.string(),
      reason: z.string(),
      confidence,
      team,
      ruleId: z.string().nullable(),
      assumptionKeys: z.array(z.string()),
      ops: z.array(AiOp),
    }),
  ),
});
export type OptimizeOutput = z.infer<typeof OptimizeOutput>;

export const ImportMappingOutput = z.strictObject({
  mappings: z.array(
    z.strictObject({
      partId: z.string(),
      candidates: z.array(z.strictObject({ stdCode: z.string(), role: z.string().nullable(), axisMap: z.string().nullable(), confidence, reason: z.string() })),
    }),
  ),
});
export type ImportMappingOutput = z.infer<typeof ImportMappingOutput>;

export const SummaryOutput = z.strictObject({ summary: z.string(), bullets: z.array(z.string()) });
export type SummaryOutput = z.infer<typeof SummaryOutput>;

export const MeetingOutput = z.strictObject({
  summary: z.string(),
  decisions: z.array(z.strictObject({ text: z.string(), partIds: z.array(z.string()), ownerTeam: team, segmentId: z.string().nullable(), confidence })),
});
export type MeetingOutput = z.infer<typeof MeetingOutput>;

export const AskOutput = z.strictObject({ answer: z.string(), citations: z.array(z.string()) });
export type AskOutput = z.infer<typeof AskOutput>;

export const SCHEMAS = {
  optimize: OptimizeOutput,
  'import-mapping': ImportMappingOutput,
  'revision-summary': SummaryOutput,
  'review-assistant': SummaryOutput,
  'meeting-assistant': MeetingOutput,
  ask: AskOutput,
} as const;
export type AiTask = keyof typeof SCHEMAS;
export type AiOutput<T extends AiTask> = z.infer<(typeof SCHEMAS)[T]>;

export function jsonSchemaFor(task: AiTask): Record<string, unknown> {
  const s = z.toJSONSchema(SCHEMAS[task], { target: 'draft-7' }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}
