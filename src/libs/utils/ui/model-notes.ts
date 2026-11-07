/**
 * Plain lines for the result card saying where a model took part (BUILD_BRIEF 2.3, honesty on screen). Rules-only
 * routes say nothing, so a result with every slot on rules looks exactly as before.
 */
export function modelNotes(routes: Array<{ route: string; version: string }>): string[] {
  const out: string[] = [];
  for (const r of routes) {
    const v = r.version;
    const embed = /\+embed\[local:([^\]]+)\]/.exec(v);
    if (embed) out.push(`Matched by meaning with local model ${embed[1]} (similar, not a confidence)`);
    const embedFail = /\+embed\[fallback:([^\]]+)\]/.exec(v);
    if (embedFail) out.push(`The embedding model was not available (${embedFail[1]}); matched by spelling instead`);
    const phrase = /^(ollama|api)-phrase@\d+:(.+)$/.exec(v);
    if (phrase) out.push(`Question worded by ${phrase[1] === 'api' ? 'hosted' : 'local'} model ${phrase[2]}`);
    const fb = /\[fallback:(extract|phrase):([^\]]+)\]$/.exec(v);
    if (fb) out.push(`The ${fb[1]} model was not available (${fb[2]}); rules were used`);
  }
  return [...new Set(out)];
}
