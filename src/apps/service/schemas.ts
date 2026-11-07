import { z } from 'zod';

/** Request validation for every body/query the HTTP API and MCP tools accept. */
export const principalSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  groups: z.array(z.string()).default([]),
  type: z.enum(['human', 'agent']).default('human'),
});

const evidenceRef = z.object({
  evidenceId: z.string(),
  span: z.object({ start: z.number(), end: z.number() }).optional(),
  excerpt: z.string().optional(),
});

export const conditionSchema = z.object({
  key: z.string().min(1),
  operator: z.enum(['eq', 'neq', 'gte', 'lte', 'contains', 'present', 'absent']),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  origin: z.enum(['reported', 'inferred']).default('reported'),
  evidence: z.array(evidenceRef).default([]),
  label: z.string().optional(),
});

const directorySchema = z.object({
  people: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), role: z.string(), groups: z.array(z.string()), actorIds: z.array(z.string()), available: z.boolean(),
  })),
});

export const importSchema = z.object({
  format: z.enum(['teams-json', 'email-text', 'slack-export', 'slack-live', 'scenario-dir']),
  path: z.string().min(1).optional(),
  payload: z.unknown().optional(),
  connectionId: z.string().optional(),
  accessGroups: z.array(z.string()).optional(),
  /** Visible organization directory to apply with an inline payload (a scenario directory's people.json). */
  directory: directorySchema.optional(),
}).refine((r) => r.path !== undefined || r.payload !== undefined, { message: 'path or payload is required' });

export const investigateSchema = z.object({
  text: z.string().trim().min(1),
  principal: principalSchema,
  entityIds: z.array(z.string()).optional(),
  observations: z.array(conditionSchema).optional(),
  attachmentNames: z.array(z.string()).optional(),
  allowQuestions: z.boolean().optional(),
  /** B1: point in time (ISO 8601 with a zone). */
  at: z.string().min(1).optional(),
});

/** B1: GET /context query. */
export const contextQuerySchema = z.object({ entity: z.string().trim().min(1), at: z.string().min(1).optional(), principalId: z.string().min(1).optional() });

export const answerSchema = z.object({
  principal: principalSchema,
  value: z.enum(['yes', 'no', 'unknown']),
  text: z.string().optional(),
});

export const principalOnlySchema = z.object({ principal: principalSchema });
export const cancelSchema = z.object({ principal: principalSchema, reason: z.string().optional() });

export const preferenceSchema = z.object({
  principal: principalSchema,
  feedback: z.object({
    personEntityId: z.string().min(1),
    comparedQuestionIds: z.tuple([z.string(), z.string()]),
    preferred: z.enum(['a', 'b', 'equal', 'neither', 'unsure']),
  }),
});

export const observationSchema = z.object({
  principal: principalSchema,
  investigationId: z.string().min(1),
  caseId: z.string().optional(),
  condition: conditionSchema,
});

export const outcomeSchema = z.object({
  principal: principalSchema,
  investigationId: z.string().min(1),
  decisionId: z.string().optional(),
  caseId: z.string().optional(),
  attemptedAction: z.string().optional(),
  result: z.enum(['recovered', 'no-change', 'worse', 'partial', 'unknown']),
  lasting: z.enum(['unknown', 'confirmed', 'recurred']).optional(),
  text: z.string().optional(),
  observations: z.array(conditionSchema).optional(),
});

export const contactDraftSchema = z.object({
  principal: principalSchema,
  investigationId: z.string().min(1),
  personEntityId: z.string().min(1),
});

export const settingsPatchSchema = z.object({
  points: z.boolean(),
  sound: z.boolean(),
  reducedMotion: z.boolean(),
  currentPersonEntityId: z.string(),
  serverUrl: z.string().min(1),
  provider: z.literal('local'),
  model: z.string(),
  mcp: z.boolean(),
  /** Extension: question selector id (rules | linucb | epsilon-greedy | random | ranker-replay or alias). */
  selectorId: z.string().min(1),
}).partial().strict();

export const demoResetSchema = z.object({ seed: z.enum(['elisa', 'synthetic', 'empty']).optional(), defaultPerson: z.string().min(1).optional() });

export const peopleQuerySchema = z.object({ investigationId: z.string().min(1), principalId: z.string().min(1) });
export const questionsQuerySchema = z.object({ personEntityId: z.string().optional(), status: z.string().optional() });
export const eventsQuerySchema = z.object({ since: z.string().optional(), traceId: z.string().optional() });
/** `{}` or `{now: null}` returns the clock to real time; `rate` is simulated seconds per real second. */
export const clockSchema = z.object({ now: z.string().min(1).nullable().optional(), rate: z.number().positive().optional() });
export const activityQuerySchema = z.object({ since: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(1000).optional() });
/** R46: points. */
export const optInSchema = z.object({ principal: principalSchema, participates: z.boolean() });
export const participationQuerySchema = z.object({ principalId: z.string().min(1).optional() });
export const ratingQuerySchema = z.object({ personEntityId: z.string().min(1).optional(), principalId: z.string().min(1).optional() });
