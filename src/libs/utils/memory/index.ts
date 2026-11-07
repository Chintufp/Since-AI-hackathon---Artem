import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AccessScope, Case, ConversationContext, EvidenceEnvelope, ExtractionProposal, ImportBatch, KnowledgeStore, Principal } from '../contracts/index.ts';
import { stableId } from '../contracts/index.ts';
import { detectPasteKind, normName, parseEmailText, parsePaste, parsePastedThread, parseSlackExport, parseTeamsJson, PASTE_CONNECTION_ID, readSlackExportDir } from '../connectors/index.ts';
import type { PastePayload, SlackExportData } from '../connectors/index.ts';
import { loadContexts } from '../context/index.ts';
import { importSources } from '../ingest/index.ts';
import { canSee } from './access.ts';
import { commitProposal, refreshClaimSupport } from './commit.ts';
import { defaultExtractionConfig, type ExtractionConfig } from './extraction-config.ts';
import { extractFromContext } from './extractor-rules.ts';
import { recordStandingGaps, type StandingGapSettings } from './standing-gaps.ts';
import { assignEpisodes } from './episodes.ts';
import { applyMembershipGrants } from './membership.ts';

export { openStore } from './sqlite-store.ts';
export type { SqliteKnowledgeStore, StoreOptions } from './sqlite-store.ts';
export { buildCaseView } from './case-view.ts';
export { contextAssertions, resolveContextEntity } from './context-assertions.ts';
export { recordStandingGaps, defaultStandingGapSettings, STANDING_PRINCIPAL_ID } from './standing-gaps.ts';
export type { StandingGapSettings, StandingResult } from './standing-gaps.ts';
export { instantOf, isNewer, parseAt, shortDate, timePosition, validAt } from './validity.ts';
export { caseCard, defaultCaseCardConfig } from './case-card.ts';
export type { CaseCardConfig } from './case-card.ts';
export { caseLabel } from './case-label.ts';
export { defaultViewConfig, humanAction, pastAction } from './view-config.ts';
export type { ViewConfig } from './view-config.ts';
export { applyCorrection } from './corrections.ts';
export type { CorrectionResult } from './corrections.ts';
export { canSee, restrictiveScope } from './access.ts';
export { commitProposal, independentSources } from './commit.ts';
export type { CommitOptions, CommitResult } from './commit.ts';
export { applyMembershipGrants, derivedGroupsOf, MEMBER_ATTR_PREFIX } from './membership.ts';
export { rebuildCase } from './case-builder.ts';
export { createRulesExtractor, extractFromContext, RULES_ROUTE } from './extractor-rules.ts';
export { defaultExtractionConfig } from './extraction-config.ts';
export { assignEpisodes } from './episodes.ts';
export {
  createLlmExtractor, buildExtractionPrompt, extractionJsonSchema, extractionOutputSchema, llmExtractRoute, locateExcerpt, renderThread, restatesRulesClaim,
  unionProposal, validateExtraction, FEW_SHOT, LLM_EXTRACT_VERSION, API_EXTRACT_VERSION,
} from './extractor-llm.ts';
export type { DroppedItem, LlmExtractor, LlmExtractorOptions, ValidatedExtraction } from './extractor-llm.ts';
export { enrichWithModel, modelProvenance } from './enrich.ts';
export { storeHealth, healthProduct, healthProductOrNull, retrievalCounts, canonicalKey, expectedGain, P_CONFIRM, pairingLinks, isApplicabilityAnswer, STORE_METRIC_METHOD, SLOTS as COMPLETENESS_SLOTS } from './store-health.ts';
export type { StoreHealth, StoreHealthOptions, CaseHealth, CompletenessSlot, GainInput } from './store-health.ts';
export type { EnrichItem, EnrichOptions, EnrichReport } from './enrich.ts';
export type { ExtractionConfig } from './extraction-config.ts';

export type ImportFormat = 'teams-json' | 'email-text' | 'slack-export' | 'slack-live' | 'scenario-dir' | 'paste';

export interface ImportFromPathRequest {
  format: ImportFormat;
  /** File or directory on this machine. */
  path?: string;
  /** Inline payload instead of a path (object / string / SlackExportData / PastePayload). */
  payload?: unknown;
  connectionId?: string;
  orgId: string;
  accessGroups?: string[];
  /** Clock injection for tests. */
  now?: string;
  config?: Partial<ExtractionConfig>;
  /**
   * B1: record capture-time standing gaps after the commit (memory/standing-gaps.ts), at `now`. Omitted = no pass
   * (experiments import without it, so their stores are unchanged).
   */
  standing?: Partial<StandingGapSettings>;
  /**
   * Called after the rules commit with every thread and its committed rules proposal (incidents already re-keyed to
   * episodes) and the import's baseline scope: the extract slot's model pass (enrich.ts) runs on exactly these.
   */
  onCommitted?: (items: Array<{ ctx: ConversationContext; proposal: ExtractionProposal }>, scope: AccessScope) => void;
}

export interface ImportFromPathResult {
  batch: ImportBatch;
  cases: number;
  claims: number;
  entities: number;
  people: number;
  /** B4: the ids behind the counts and the evidence read (inserted or already known), for the capture receipt. */
  ids?: { cases: string[]; entities: string[]; people: string[]; evidence: string[] };
}

/** "Remember this" payload over HTTP: the text itself, or the PastePayload object with an optional author name. */
export type PasteInput = string | { text: string; attachmentNames?: string[]; authorName?: string };

/**
 * B4: a paste is sniffed (connectors/paste-thread.ts) and goes to the adapter that keeps its structure: a chat thread
 * to the Teams adapter (provider 'teams', so speakers are bound), an e-mail to the e-mail adapter, a JSON export to the
 * Teams adapter, anything else to the single-note paste adapter. All under connection 'paste:desktop' unless the caller
 * names one. Text verbatim, a time-only stamp stays partial, a missing time stays unknown.
 */
export function parsePasteInput(input: PasteInput, opts: { orgId: string; connectionId?: string; accessGroups?: string[]; ingestedAt?: string }): { envelopes: EvidenceEnvelope[]; description: string } {
  // Only the documented fields are read: an `author` object in the payload is ignored, so a caller can never attribute
  // a note to someone else's identity (the name given is stored under the paste provider, never as a directory actor).
  const p: { text: string; attachmentNames?: string[]; authorName?: string } = typeof input === 'string' ? { text: input } : input;
  if (!p || typeof p.text !== 'string') throw new Error('paste: expected text');
  const o = { ...opts, connectionId: opts.connectionId ?? PASTE_CONNECTION_ID };
  const kind = detectPasteKind(p.text);
  if (kind === 'empty') throw new Error('paste: nothing to remember (empty text)');
  if (kind === 'email') return { envelopes: parseEmailText(p.text, o), description: 'Pasted e-mail' };
  if (kind === 'teams-json') return { envelopes: parseTeamsJson(JSON.parse(p.text.trim()), o), description: 'Pasted Teams export' };
  if (kind === 'thread') return { envelopes: parseTeamsJson(parsePastedThread(p.text)!, o), description: 'Pasted thread' };
  const author = (p.authorName?.trim() ? { id: `person:paste:${normName(p.authorName)}`, displayName: p.authorName.trim(), provider: 'paste' } : undefined);
  return { envelopes: parsePaste({ text: p.text, ...(p.attachmentNames ? { attachmentNames: p.attachmentNames } : {}), ...(author ? { author } : {}) }, o), description: 'Pasted text' };
}

const IGNORED = /^(truth|incoming)\.json$/i;

function importOne(store: KnowledgeStore, format: Exclude<ImportFormat, 'scenario-dir'>, req: ImportFromPathRequest, source: { path?: string; payload?: unknown }) {
  const opts = { orgId: req.orgId, connectionId: req.connectionId, accessGroups: req.accessGroups, reference: source.path, ingestedAt: req.now };
  let envelopes: EvidenceEnvelope[];
  let description: string;
  if (format === 'teams-json') {
    const data = source.payload ?? JSON.parse(readFileSync(source.path!, 'utf8'));
    envelopes = parseTeamsJson(typeof data === 'string' ? JSON.parse(data) : data, opts);
    description = `Teams JSON ${source.path ?? '(inline)'}`;
  } else if (format === 'email-text') {
    envelopes = parseEmailText(typeof source.payload === 'string' ? source.payload : readFileSync(source.path!, 'utf8'), opts);
    description = `Email text ${source.path ?? '(inline)'}`;
  } else if (format === 'slack-export' || format === 'slack-live') {
    const data = (source.payload as SlackExportData | undefined) ?? readSlackExportDir(source.path!);
    // A live pull is the same export shape read through the read-only live client (connectors/slack-live-pull.ts).
    envelopes = parseSlackExport(data, format === 'slack-live' ? { ...opts, connectionId: opts.connectionId ?? 'slack-live' } : opts);
    description = format === 'slack-live' ? 'Slack live (read-only pull of one channel)' : `Slack export ${source.path ?? '(inline)'}`;
  } else {
    ({ envelopes, description } = parsePasteInput(source.payload as PasteInput, opts));
  }
  const connectionId = envelopes[0]?.connectionId ?? req.connectionId ?? format;
  return importSources(store, envelopes, { orgId: req.orgId, connectionId, sourceDescription: description, now: req.now });
}

function listScenarioSources(dir: string): Array<{ format: Exclude<ImportFormat, 'scenario-dir' | 'paste'>; path: string }> {
  const roots = [dir, join(dir, 'sources')].filter((d) => existsSync(d) && statSync(d).isDirectory());
  const out: Array<{ format: 'teams-json' | 'email-text' | 'slack-export'; path: string }> = [];
  for (const root of roots) {
    for (const f of readdirSync(root).sort()) {
      const p = join(root, f);
      if (IGNORED.test(f)) continue;
      if (statSync(p).isDirectory()) {
        if (existsSync(join(p, 'users.json')) || existsSync(join(p, 'channels.json'))) out.push({ format: 'slack-export', path: p });
      } else if (/teams.*\.json$/i.test(f)) out.push({ format: 'teams-json', path: p });
      else if (/\.(txt|eml)$/i.test(f) && !/readme/i.test(f)) out.push({ format: 'email-text', path: p });
    }
  }
  return out;
}

/** adapters -> ingest -> context -> rules extraction -> memory commit. Safe to run again on the same source. */
export function importFromPath(store: KnowledgeStore, req: ImportFromPathRequest): ImportFromPathResult {
  const cfg: ExtractionConfig = { ...defaultExtractionConfig, ...(req.config ?? {}) };
  const scope: AccessScope = req.accessGroups?.length ? { visibility: 'group', groups: req.accessGroups } : { visibility: 'org' };
  const batches: ImportBatch[] = [];
  const evidence: EvidenceEnvelope[] = [];
  const relinked: string[] = [];
  if (req.format === 'scenario-dir') {
    if (!req.path) throw new Error('scenario-dir import needs a path');
    for (const s of listScenarioSources(req.path)) {
      const r = importOne(store, s.format, { ...req, connectionId: undefined }, { path: s.path });
      batches.push(r.batch);
      evidence.push(...r.evidence);
      relinked.push(...r.relinked);
    }
  } else {
    const r = importOne(store, req.format, req, { path: req.path, payload: req.payload });
    batches.push(r.batch);
    evidence.push(...r.evidence);
    relinked.push(...r.relinked);
  }
  const cases = new Set<string>(), claims = new Set<string>(), entities = new Set<string>(), people = new Set<string>();
  const items = loadContexts(store, req.orgId, evidence.map((e) => e.id), { aliases: cfg.aliases }).map((ctx) => ({ ctx, proposal: extractFromContext(ctx, cfg) }));
  assignEpisodes(store, req.orgId, items, cfg); // separate episodes on one asset, write-ups attach to the right one
  for (const { ctx, proposal } of items) {
    const r = commitProposal(store, proposal, ctx, { orgId: req.orgId, accessScope: scope, now: req.now });
    r.caseIds.forEach((x) => cases.add(x));
    r.claimIds.forEach((x) => claims.add(x));
    r.entityIds.forEach((x) => entities.add(x));
    r.personEntityIds.forEach((x) => people.add(x));
  }
  applyMembershipGrants(store, req.orgId, evidence);
  refreshClaimSupport(store, relinked, req.now);
  if (req.standing) recordStandingGaps(store, { orgId: req.orgId, now: req.now ?? new Date().toISOString(), settings: req.standing });
  req.onCommitted?.(items, scope);
  const sum = (k: keyof ImportBatch['counts']) => batches.reduce((n, b) => n + b.counts[k], 0);
  const batch: ImportBatch =
    batches.length === 1
      ? batches[0]!
      : {
          id: stableId('batch', ...batches.map((b) => b.id)), orgId: req.orgId, connectionId: 'scenario-dir', startedAt: batches[0]?.startedAt ?? new Date().toISOString(),
          finishedAt: new Date().toISOString(), sourceDescription: `Scenario directory ${req.path} (${batches.length} sources)`,
          counts: { seen: sum('seen'), inserted: sum('inserted'), unchangedDuplicates: sum('unchangedDuplicates'), revised: sum('revised'), copies: sum('copies') },
        };
  return {
    batch, cases: cases.size, claims: claims.size, entities: entities.size, people: people.size,
    ids: { cases: [...cases], entities: [...entities], people: [...people], evidence: evidence.map((e) => e.id) },
  };
}

/** Cases visible to the principal (all cases when no principal is given: trusted/internal callers only). */
export function listCases(store: KnowledgeStore, principal?: Pick<Principal, 'id' | 'groups'>, orgId?: string): Case[] {
  return store.list('case', orgId ? { where: { orgId } } : {}).filter((c) => !principal || canSee(c.accessScope, principal));
}
