/** RFC 822-style header block of a plain-text e-mail. No imports, so the desktop renderer can sniff a paste with it. */
export interface ParsedEmail {
  headers: Record<string, string>;
  body: string;
}

export function parseEmailHeaders(raw: string): ParsedEmail {
  const text = raw.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const headers: Record<string, string> = {};
  let i = 0;
  let last = '';
  for (; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.trim() === '') { i++; break; }
    const m = /^([A-Za-z][A-Za-z0-9-]*):\s?(.*)$/.exec(l);
    if (m) {
      last = m[1]!.toLowerCase();
      headers[last] = m[2]!.trim();
    } else if (/^\s+/.test(l) && last) headers[last] += ' ' + l.trim();
    else { i = 0; break; } // not a header block at all
  }
  if (!Object.keys(headers).length) return { headers: {}, body: text };
  return { headers, body: lines.slice(i).join('\n').trim() };
}
