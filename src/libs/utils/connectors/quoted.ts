/**
 * Detect quoted / forwarded parts of an email body.
 * Recognized: ">"-prefixed blocks, "On ... wrote:" tails, "-----Original Message-----",
 * "---------- Forwarded message ----------", and Outlook-style "From:/Sent:" header blocks.
 */
export interface QuotedSegment {
  kind: 'gt' | 'wrote' | 'forwarded' | 'original';
  /** Quoted text with quote markers removed. */
  text: string;
  /** Character offsets into the original body. */
  start: number;
  end: number;
}

export interface SplitBody {
  fresh: string;
  quoted: QuotedSegment[];
}

const WROTE = /^on\s.+\swrote:\s*$/i;
const WROTE_START = /^on\s.+[,\s]/i;
const FORWARD = /^-{2,}\s*forwarded message\s*-{2,}\s*$/i;
const ORIGINAL = /^-{2,}\s*original message\s*-{2,}\s*$/i;
const OUTLOOK = /^from:\s.+$/i;

export function splitEmailBody(body: string): SplitBody {
  const lines: Array<{ text: string; start: number }> = [];
  let off = 0;
  for (const l of body.split('\n')) {
    lines.push({ text: l, start: off });
    off += l.length + 1;
  }
  const quoted: QuotedSegment[] = [];
  const freshParts: string[] = [];
  let i = 0;
  const strip = (l: string) => l.replace(/^(\s*>)+ ?/, '');
  while (i < lines.length) {
    const { text, start } = lines[i]!;
    const t = text.trim();
    const next = lines[i + 1]?.text.trim() ?? '';
    let tailKind: QuotedSegment['kind'] | undefined;
    let skip = 1;
    if (WROTE.test(t)) tailKind = 'wrote';
    else if (WROTE_START.test(t) && /wrote:\s*$/i.test(next) && next.length < 12) { tailKind = 'wrote'; skip = 2; }
    else if (FORWARD.test(t)) tailKind = 'forwarded';
    else if (ORIGINAL.test(t)) tailKind = 'original';
    else if (OUTLOOK.test(t) && /^(sent|date):\s/i.test(next) && i > 0) { tailKind = 'original'; skip = 0; }
    if (tailKind) {
      // Everything from here to the end is quoted (header lines of the quote are dropped).
      const rest = lines.slice(i + skip).map((l) => strip(l.text));
      const quotedText = rest.join('\n').trim();
      quoted.push({ kind: tailKind, text: quotedText, start, end: body.length });
      break;
    }
    if (/^\s*>/.test(text)) {
      const j0 = i;
      const block: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!.text)) {
        block.push(strip(lines[i]!.text));
        i++;
      }
      const last = lines[i - 1]!;
      quoted.push({ kind: 'gt', text: block.join('\n').trim(), start: lines[j0]!.start, end: last.start + last.text.length });
      continue;
    }
    freshParts.push(text);
    i++;
  }
  return { fresh: freshParts.join('\n').replace(/\n{3,}/g, '\n\n').trim(), quoted };
}

/** "RE: Fwd: Subject" -> "subject" for thread grouping. */
export function normalizeSubject(subject: string | undefined): string {
  let s = (subject ?? '').trim();
  while (/^(re|fw|fwd|vs|sv|aw)\s*:\s*/i.test(s)) s = s.replace(/^(re|fw|fwd|vs|sv|aw)\s*:\s*/i, '');
  return s.toLowerCase().replace(/\s+/g, ' ');
}

export const isReplySubject = (subject: string | undefined): boolean => /^\s*(re|fw|fwd)\s*:/i.test(subject ?? '');
