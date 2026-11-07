/** Plain-language provenance of a stored claim (BUILD_BRIEF 2.3, honesty on screen). */
/** "proposed by local model qwen3:4b, committed by rules" for a claim a model proposed; undefined for a rules claim. */
export function modelProvenance(extraction: { route: string; version: string }): string | undefined {
  if (extraction.route !== 'local' && extraction.route !== 'api') return undefined;
  const model = extraction.version.includes(':') ? extraction.version.slice(extraction.version.indexOf(':') + 1) : extraction.version;
  return `proposed by ${extraction.route === 'api' ? 'hosted' : 'local'} model ${model}, committed by rules`;
}
