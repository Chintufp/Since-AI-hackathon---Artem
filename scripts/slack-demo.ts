/**
 * The Slack path, on a SYNTHETIC export (no workspace is contacted): import the `config-rollback-private` family through
 * the slack-export connector (private channel #change-review with a member list, public #noc-general), then show the
 * access gate: a non-member and a member ask the same question and get different cases and sources.
 *   node scripts/slack-demo.ts [--url http://127.0.0.1:47831]
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { CaseView, DirectoryEntry } from '../src/libs/utils/contracts/index.ts';
import { DEFAULT_SERVICE_PORT } from '../src/libs/utils/contracts/index.ts';
import { REPO_ROOT } from '../src/apps/service/paths.ts';
import { httpClient } from '../src/libs/utils/simulation/index.ts';

const { values } = parseArgs({ options: { url: { type: 'string', default: `http://127.0.0.1:${DEFAULT_SERVICE_PORT}` } } });
const client = httpClient(values.url);
const say = (s = ''): void => { process.stdout.write(s + '\n'); };

const health = await client.get<{ ok: boolean }>('/health').catch(() => undefined);
if (!health?.ok) {
  process.stderr.write(`No service at ${values.url}. Start it with \`pnpm service\` or \`pnpm demo:judge\`.\n`);
  process.exit(1);
}
const dir = join(REPO_ROOT, 'data', 'scenarios', 'config-rollback-private');
say('SYNTHETIC Slack export (data/scenarios/config-rollback-private/sources/slack-export): no workspace is contacted; the live connector stays "awaiting authorization".');
const r = await client.post<{ cases: number; claims: number; people: number; batch: { counts: { inserted: number; unchangedDuplicates: number } } }>('/import', { format: 'scenario-dir', path: dir });
say(`Imported family config-rollback-private (Teams thread, e-mail, Slack export with private #change-review and public #noc-general): ${r.batch.counts.inserted} new records, ${r.batch.counts.unchangedDuplicates} already known → ${r.cases} cases, ${r.claims} claims, ${r.people} people.`);

const directory = await client.get<DirectoryEntry[]>('/directory');
const person = (name: string): DirectoryEntry => {
  const d = directory.find((x) => x.name === name);
  if (!d) throw new Error(`${name} is not in the directory`);
  return d;
};
const text = 'ACC-33 is an N5 and lost voice VLAN 210 after the template v7 push. Can I roll it back to v6 like Jarmo did on ACC-12?';
for (const name of ['Elina Mattila', 'Antti Korhonen']) {
  const p = person(name);
  say(`\n== ${name} · ${p.role} · groups [${p.groups.join(', ')}]`);
  const cases = await client.get<CaseView[]>(`/cases?principalId=${encodeURIComponent(p.personEntityId)}`);
  const acc = cases.filter((c) => /ACC-/.test(c.title));
  say(`cases visible: ${acc.map((c) => c.title).join(' | ')}`);
  for (const c of acc.filter((x) => /ACC-30/.test(x.title))) {
    say(`sources of "${c.title}" (private channel):`);
    for (const s of c.sources) say(`  ${s.provider} · ${s.author}: ${s.excerpt}`);
  }
  const inv = await client.post<{ recommendation: { kind: string; text: string }; matches: Array<{ title: string }>; people: Array<{ name: string }>; loopReason?: string }>('/investigate', {
    text, principal: { id: p.personEntityId, displayName: p.name, groups: p.groups, type: 'human' }, allowQuestions: false,
  });
  say(`asks: "${text}"`);
  say(`  recommendation (${inv.recommendation.kind}): ${inv.recommendation.text}`);
  say(`  matches: ${inv.matches.map((m) => m.title).join(' | ')}`);
  say(`  people: ${inv.people.map((x) => x.name).join(', ') || '-'}`);
}
say('\nThe private-channel case (ACC-30, "Do not roll back N5 units") exists only for channel members: membership comes from the export\'s channel member list and is recorded on the person. Nothing was sent anywhere.');
