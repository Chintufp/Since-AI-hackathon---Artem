import { parseEmailHeaders } from './email-text.ts';
import type { TeamsExport } from './teams-json.ts';

/**
 * "Remember this" (B4 D1): what a pasted or dropped text is, so the paste import can hand it to the adapter that keeps
 * its speakers (a chat thread), its headers (an e-mail) or, failing both, stores it as one note. Pure: no I/O.
 *
 * Recognised clipboard shapes for a thread (lines after a speaker line continue that message):
 *  - '[09:14] Name: text'          (time in brackets)
 *  - '09:14 Name: text'            (bare time first)
 *  - 'Name  9:14 AM' + body lines   (the Teams desktop copy shape; also '[9:14 AM] Name' and '[11/7 9:14 AM] Name')
 *  - 'Name: text'                  (no time; only with at least two different speakers)
 * Times are kept verbatim; the adapter keeps a time-only stamp partial (date unknown), never 'now'.
 */
export type PasteKind = 'empty' | 'email' | 'teams-json' | 'thread' | 'note';

/** A person's name: one to four capitalised words, lower-case particles allowed between them ('Anna van Dijk'). */
const NAME = String.raw`[\p{Lu}][\p{L}\p{M}.'’-]*(?: (?:(?:van|von|de|der|den|af|al|da|di|du|la|le) )?[\p{Lu}][\p{L}\p{M}.'’-]*){0,3}`;
const TIME = String.raw`\d{1,2}[:.]\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?`;
const BRACKET_TIME = String.raw`\[(?:[^\]\n]{0,24}?\s)?(${TIME})\]`;

const RE_BRACKET_LINE = new RegExp(String.raw`^${BRACKET_TIME}\s*[-–]?\s*(${NAME})\s*:\s*(.*)$`, 'u');
const RE_TIME_LINE = new RegExp(String.raw`^(${TIME})\s*[-–]?\s+(${NAME})\s*:\s*(.*)$`, 'u');
const RE_HEADER_NAME_TIME = new RegExp(String.raw`^(${NAME})[ \t,]+(?:(?:\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?|Yesterday|Today)\s+)?(${TIME})\s*$`, 'u');
const RE_HEADER_TIME_NAME = new RegExp(String.raw`^${BRACKET_TIME}\s*(${NAME})\s*$`, 'u');
const RE_PLAIN_LINE = new RegExp(String.raw`^(${NAME})\s*:\s+(\S.*)$`, 'u');

/**
 * Words that start labelled lines in notes and problem descriptions ('Problem: …', 'Steps: …', 'Link: up'). A 'Name:'
 * line whose name is one of these is not a speaker, so a structured note is never mistaken for a thread.
 */
const LABELS = new Set([
  'problem', 'problems', 'issue', 'issues', 'steps', 'step', 'note', 'notes', 'summary', 'status', 'action', 'actions', 'result', 'results',
  'update', 'todo', 'question', 'questions', 'answer', 'error', 'errors', 'cause', 'fix', 'workaround', 'symptom', 'symptoms', 'link', 'traffic',
  'alarm', 'alarms', 'counters', 'rx', 'tx', 'ip', 'port', 'node', 'site', 'unit', 'date', 'time', 'subject', 'from', 'to', 'cc', 'bcc', 're', 'fw',
  'fwd', 'http', 'https', 'ps', 'nb', 'edit', 'edited', 'warning', 'info', 'debug', 'log', 'output', 'input', 'expected', 'actual', 'tip', 'hint',
  'example', 'eg', 'ie', 'ticket', 'case', 'priority', 'severity', 'owner', 'assignee', 'customer', 'location', 'device', 'model', 'version',
]);

interface Msg { author: string; time?: string; lines: string[] }

/** A pasted chat thread as a TeamsExport (channel 'pasted'), or null when the text is not a thread. */
export function parsePastedThread(text: string): TeamsExport | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const timed = lines.some((l) => RE_BRACKET_LINE.test(l.trim()) || RE_TIME_LINE.test(l.trim()) || isHeader(l.trim()));
  const msgs: Msg[] = [];
  let cur: Msg | undefined;
  for (const raw of lines) {
    const l = raw.trim();
    const hit = speakerLine(l, timed);
    if (hit) {
      cur = { author: hit.author, ...(hit.time ? { time: hit.time } : {}), lines: hit.text ? [hit.text] : [] };
      msgs.push(cur);
      continue;
    }
    if (!cur) {
      if (l) return null; // free text before the first speaker: a note, not a thread
      continue;
    }
    cur.lines.push(l);
  }
  const messages = msgs
    .map((m) => ({ author: m.author, ...(m.time ? { time: m.time } : {}), text: m.lines.join('\n').trim() }))
    .filter((m) => m.text);
  if (messages.length < 2) return null;
  if (!timed && new Set(messages.map((m) => m.author.toLowerCase())).size < 2) return null;
  return { channel: 'pasted', messages: messages.map((m, i) => ({ seq: i + 1, ...m })) };
}

function isHeader(l: string): boolean {
  const a = RE_HEADER_NAME_TIME.exec(l);
  if (a && !isLabel(a[1]!)) return true;
  const b = RE_HEADER_TIME_NAME.exec(l);
  return !!b && !isLabel(b[2]!);
}

const isLabel = (name: string): boolean => LABELS.has(name.toLowerCase().replace(/[.'’-]/g, '')) || LABELS.has(name.split(' ')[0]!.toLowerCase());

function speakerLine(l: string, timed: boolean): { author: string; time?: string; text: string } | null {
  if (!l) return null;
  let m = RE_BRACKET_LINE.exec(l);
  if (m && !isLabel(m[2]!)) return { time: m[1]!, author: m[2]!, text: m[3]!.trim() };
  m = RE_TIME_LINE.exec(l);
  if (m && !isLabel(m[2]!)) return { time: m[1]!, author: m[2]!, text: m[3]!.trim() };
  m = RE_HEADER_NAME_TIME.exec(l);
  if (m && !isLabel(m[1]!)) return { author: m[1]!, time: m[2]!, text: '' };
  m = RE_HEADER_TIME_NAME.exec(l);
  if (m && !isLabel(m[2]!)) return { time: m[1]!, author: m[2]!, text: '' };
  // Plain 'Name: text' only when no line carries a time: inside a timed thread a 'Note: …' body line stays body text.
  if (!timed) {
    m = RE_PLAIN_LINE.exec(l);
    if (m && !isLabel(m[1]!)) return { author: m[1]!, text: m[2]!.trim() };
  }
  return null;
}

/** An e-mail needs a sender, recipient, subject or message id header: 'Veikko: hi' alone is a chat line, not a header. */
const EMAIL_HEADERS = ['from', 'to', 'subject', 'message-id'];

/** Which adapter a pasted text goes to. Order: empty, JSON export, e-mail, thread, note. */
export function detectPasteKind(text: string): PasteKind {
  const t = text.trim();
  if (!t) return 'empty';
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t) as { messages?: unknown };
      if (j && Array.isArray(j.messages)) return 'teams-json';
    } catch { /* not JSON: fall through */ }
  }
  const { headers } = parseEmailHeaders(t);
  if (EMAIL_HEADERS.some((h) => headers[h] !== undefined)) return 'email';
  if (parsePastedThread(t)) return 'thread';
  return 'note';
}
