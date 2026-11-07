import type { Condition } from '../contracts/index.ts';
import { routeInfo } from '../models/routes.ts';

export interface LexiconRule {
  id: string;
  /** Regex source, matched case-insensitively. */
  pattern: string;
  key: string;
  value?: string | number | boolean;
  /** Use this capture group (lowercased) as the value instead of `value`. */
  valueGroup?: number;
  numeric?: boolean;
  /** `{value}` is replaced by the matched value. */
  label: string;
  origin?: 'reported' | 'inferred';
  /** Skip when the match is directly preceded by a negation (default true). */
  negatable?: boolean;
}

/** Default lexicon: configuration, not logic. Organizations replace or extend it. */
export const DEFAULT_LEXICON: LexiconRule[] = [
  { id: 'link-up', pattern: String.raw`\b(?:link|interface|port)\s+(?:is\s+|stays\s+|remains\s+|shows\s+)?(?:still\s+)?up\b`, key: 'interface.status', value: 'up', label: 'Interface up' },
  { id: 'link-down', pattern: String.raw`\b(?:link|interface|port)\s+(?:is\s+|stays\s+|remains\s+)?(?:still\s+)?down\b`, key: 'interface.status', value: 'down', label: 'Interface down' },
  { id: 'counters-zero', pattern: String.raw`\bcounters?\s+(?:are\s+|stay\s+|stays\s+|remain\s+|is\s+)?(?:at\s+)?(?:zero|0|flat)\b|\bzero\s+(?:traffic\s+)?counters?\b|\bcounters?\s+(?:not|aren't|don't)\s+(?:increasing|moving|incrementing)\b`, key: 'traffic.counters', value: 'zero', label: 'Traffic counters zero' },
  { id: 'rx-normal', pattern: String.raw`\b(?:rx|optical)\s+(?:power\s+|level\s+)?(?:is\s+|are\s+|looks?\s+)?(?:normal|ok|fine|good)\b|\bnormal\s+rx\b`, key: 'optical.level', value: 'normal', label: 'RX power normal' },
  { id: 'rx-low', pattern: String.raw`\b(?:rx|optical)\s+(?:power\s+|level\s+)?(?:is\s+)?low\b|\blow\s+rx\b`, key: 'optical.level', value: 'low', label: 'RX power low' },
  { id: 'traffic-absent', pattern: String.raw`\b(?:no|zero)\s+traffic\b(?!\s+counters?)|\btraffic\s+(?:is\s+|are\s+|has\s+|have\s+)?(?:still\s+|yet\s+)?(?:not|never)\s+(?:coming\s+back|come\s+back|flowing|passing|returned?|returning|recovered)\b|\btraffic\s+(?:is\s+|stays\s+|remains\s+)?(?:still\s+)?down\b`, key: 'traffic.state', value: 'absent', label: 'No traffic', negatable: false },
  { id: 'traffic-flowing', pattern: String.raw`\btraffic\s+(?:is\s+|has\s+|have\s+)?(?:now\s+|finally\s+)?(?:back|returned|flowing|restored|recovered|passing)\b`, key: 'traffic.state', value: 'flowing', label: 'Traffic flowing' },
  { id: 'alarms-cleared', pattern: String.raw`\balarms?\s+(?:are\s+|have\s+been\s+|has\s+been\s+)?(?:cleared|clear)\b|\bno\s+(?:active\s+)?alarms?\b`, key: 'alarms.state', value: 'cleared', label: 'Alarms cleared', negatable: false },
  { id: 'alarms-active', pattern: String.raw`\b(?:active\s+alarms?|alarms?\s+(?:are\s+)?(?:active|raised|firing))\b`, key: 'alarms.state', value: 'active', label: 'Alarms active' },
  { id: 'unit-older', pattern: String.raw`\bold(?:er)?[\s-]+(?:unit|hardware|card|controller|revision|model)\b`, key: 'unit.age', value: 'older', label: 'Older unit' },
  { id: 'unit-newer', pattern: String.raw`\b(?:new|newer|recent)[\s-]+(?:unit|hardware|card|controller|revision|model)\b`, key: 'unit.age', value: 'newer', label: 'Newer unit' },
  { id: 'unit-year', pattern: String.raw`\b(?:old|older|unit|card|hardware|controller|installed|manufactured)(?:\s+(?:in|from|of))?[\s/(,-]*((?:19|20)\d\d)\b`, key: 'unit.installed_year', valueGroup: 1, numeric: true, label: 'Installed in {value}', origin: 'inferred' },
  { id: 'component-replaced', pattern: String.raw`\b(?:changed|replaced|swapped)\s+(?:out\s+)?(?:the\s+|a\s+|our\s+)?(sfp|fan|psu|cable|module|card)\b`, key: 'component.replaced', valueGroup: 1, label: 'Component replaced: {value}' },
  { id: 'rebooted', pattern: String.raw`\b(?:re-?booted|restarted)\b`, key: 'action.performed', value: 'device.reboot', label: 'Device rebooted' },
  { id: 'power-cycled', pattern: String.raw`\bpower[\s-]?cycled\b`, key: 'action.performed', value: 'power.cycle', label: 'Power cycled' },
  { id: 'reset', pattern: String.raw`\b(?:reset|bounced|flapped)\s+(?:the\s+)?(?:interface|port|link)\b`, key: 'action.performed', value: 'interface.reset', label: 'Interface reset' },
  { id: 'bgp-flapping', pattern: String.raw`\bbgp\b[^.;\n]{0,30}?\bflap(?:s|ping|ped)?\b`, key: 'bgp.session', value: 'flapping', label: 'BGP session flapping' },
  { id: 'bgp-session', pattern: String.raw`\bbgp\b[^.;\n]{0,30}?\b(down|established|up)\b`, key: 'bgp.session', valueGroup: 1, label: 'BGP session {value}' },
  { id: 'config-changed', pattern: String.raw`\b(?:after|since|following)\s+(?:the\s+|a\s+)?(?:(?:firmware|software|config(?:uration)?)\s+)?(?:update|upgrade|change|release)\b`, key: 'config.changed', value: true, label: 'Recent change', negatable: false },
  { id: 'site-access', pattern: String.raw`\b(?:barrier|locked\s+gate|gate\s+(?:is\s+)?locked|gate\s+code|key\s*box)\b`, key: 'site.access', value: 'barrier', label: 'Site access restriction', negatable: false },
];

/**
 * Conservative extractor for a stated equipment model ("ACC-33 is an N5", "an N5 unit", "model N5"). Configuration, not logic.
 * Each pattern is matched case-insensitively with `{asset}` and `{model}` replaced by their loose sources and must expose the
 * model in the named group `model`; the captured token is then checked case-sensitively against `tokenPattern` and rejected
 * when it matches `excludePattern` (asset ids look like models). A token that fails either check is not a model.
 */
export interface ModelParserConfig {
  key: string;
  label: string;
  patterns: string[];
  assetSource: string;
  tokenPattern: string;
  excludePattern: string;
}

export const DEFAULT_MODEL_PARSER: ModelParserConfig = {
  key: 'unit.model',
  label: 'Model {model}',
  patterns: [
    String.raw`{asset}\s+(?:is|was)\s+an?\s+(?<model>{model})\b`,
    String.raw`\ban?\s+(?<model>{model})\s+(?:model|unit)\b`,
    String.raw`\bmodel\s+(?<model>{model})\b`,
  ],
  assetSource: String.raw`\b[A-Za-z][A-Za-z0-9]{1,9}-[A-Za-z0-9]{1,8}\b`,
  tokenPattern: String.raw`^[A-Z]{1,3}-?\d{1,3}[A-Z]?$`,
  excludePattern: String.raw`^[A-Z]{2,6}-\d{1,6}$`,
};

export interface ParserOptions {
  lexicon?: LexiconRule[];
  /** Model extractor; `null` disables it. Default DEFAULT_MODEL_PARSER. */
  modelParser?: ModelParserConfig | null;
  /** installed_year <= this year also yields unit.age=older (inferred). Omit to disable. Default 2019. */
  olderThroughYear?: number | null;
}

export interface ParsedProblem {
  conditions: Condition[];
  route: ReturnType<typeof routeInfo>;
}

const NEGATION = /\b(?:not|no|never|isn't|aren't|wasn't|don't|didn't|haven't|hasn't|without)\s*$/i;

/** Maps free text to Conditions using the shared vocabulary keys. First match per key wins. */
export function parseProblemText(text: string, problemId: string, opts: ParserOptions = {}): ParsedProblem {
  const lexicon = opts.lexicon ?? DEFAULT_LEXICON;
  const found = new Map<string, { index: number; cond: Condition }>();
  for (const rule of lexicon) {
    const re = new RegExp(rule.pattern, 'gi');
    for (const m of text.matchAll(re)) {
      const index = m.index ?? 0;
      if (rule.negatable !== false && NEGATION.test(text.slice(Math.max(0, index - 14), index))) continue;
      let value: string | number | boolean | undefined = rule.value;
      if (rule.valueGroup !== undefined) {
        const g = m[rule.valueGroup];
        if (g === undefined) continue;
        value = rule.numeric ? Number(g) : g.toLowerCase();
      }
      if (value === undefined) continue;
      const cond: Condition = {
        key: rule.key, operator: 'eq', value, origin: rule.origin ?? 'reported', label: rule.label.replaceAll('{value}', String(value)),
        evidence: [{ evidenceId: `problem:${problemId}`, span: { start: index, end: index + m[0].length }, excerpt: m[0] }],
      };
      const prev = found.get(rule.key);
      if (!prev || index < prev.index) found.set(rule.key, { index, cond });
      break;
    }
  }
  const mp = opts.modelParser === undefined ? DEFAULT_MODEL_PARSER : opts.modelParser;
  if (mp && !found.has(mp.key)) {
    const model = findModel(text, mp);
    if (model) {
      found.set(mp.key, {
        index: model.index,
        cond: {
          key: mp.key, operator: 'eq', value: model.value, origin: 'reported', label: mp.label.replace('{model}', model.value),
          evidence: [{ evidenceId: `problem:${problemId}`, span: { start: model.index, end: model.index + model.length }, excerpt: model.excerpt }],
        },
      });
    }
  }
  const conditions = [...found.values()].sort((a, b) => a.index - b.index).map((f) => f.cond);
  const cutoff = opts.olderThroughYear === undefined ? 2019 : opts.olderThroughYear;
  const year = conditions.find((c) => c.key === 'unit.installed_year');
  if (cutoff !== null && year && typeof year.value === 'number' && year.value <= cutoff && !conditions.some((c) => c.key === 'unit.age')) {
    conditions.push({ key: 'unit.age', operator: 'eq', value: 'older', origin: 'inferred', label: `Older unit (installed ${year.value})`, evidence: year.evidence });
  }
  return { conditions, route: routeInfo('problem-parser') };
}

function findModel(text: string, mp: ModelParserConfig): { value: string; index: number; length: number; excerpt: string } | undefined {
  const token = new RegExp(mp.tokenPattern);
  const exclude = new RegExp(mp.excludePattern);
  let best: { value: string; index: number; length: number; excerpt: string } | undefined;
  for (const source of mp.patterns) {
    const re = new RegExp(source.replaceAll('{asset}', `(?:${mp.assetSource})`).replaceAll('{model}', '[A-Za-z0-9-]{2,8}'), 'gi');
    for (const m of text.matchAll(re)) {
      const value = m.groups?.model;
      const index = m.index ?? 0;
      if (!value || !token.test(value) || exclude.test(value)) continue;
      if (NEGATION.test(text.slice(Math.max(0, index - 14), index))) continue;
      if (!best || index < best.index) best = { value, index, length: m[0].length, excerpt: m[0] };
      break;
    }
  }
  return best;
}
