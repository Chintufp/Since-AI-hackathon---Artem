/**
 * The Slack path.
 *   pnpm demo:slack                      SYNTHETIC export of the config-rollback-private family (no workspace is contacted)
 *   pnpm demo:slack --live --workspace "<team name>" --channel "#channel" [--limit 50]
 *                                        LIVE, READ-ONLY pull of one channel of a sandbox workspace. Refuses unless the
 *                                        shell has KT_SLACK_LIVE=1 and KT_SLACK_TOKEN (set by the operator at demo time;
 *                                        never read from anywhere else, never printed, logged or stored). One auth.test,
 *                                        the team name must match --workspace, then the named channel's info, members and
 *                                        last N messages plus users.list. No write scope, nothing posted, no other channel.
 * Both paths then show the access gate: a member of a private channel sees what was said there, a non-member does not.
 *   [--url http://127.0.0.1:47831]
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { CaseView, DirectoryEntry } from '../src/libs/utils/contracts/index.ts';
import { DEFAULT_SERVICE_PORT } from '../src/libs/utils/contracts/index.ts';
import { checkLiveGuard, pullChannelReadOnly, slackWebClient, SlackApiError, WorkspaceMismatchError } from '../src/libs/utils/connectors/index.ts';
import { DEFAULT_ACTIVITY_LOG } from '../src/apps/service/activity.ts';
import { REPO_ROOT } from '../src/apps/service/paths.ts';
import { httpClient, jsonlSink } from '../src/libs/utils/simulation/index.ts';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: `http://127.0.0.1:${DEFAULT_SERVICE_PORT}` },
    live: { type: 'boolean', default: false },
    workspace: { type: 'string' },
    channel: { type: 'string' },
    limit: { type: 'string', default: '50' },
  },
});
const client = httpClient(values.url);
const say = (s = ''): void => { process.stdout.write(s + '\n'); };
type ImportRes = { cases: number; claims: number; people: number; batch: { id: string; counts: { inserted: number; unchangedDuplicates: number } } };
type Principal = { id: string; displayName: string; groups: string[]; type: 'human' };

const health = await client.get<{ ok: boolean }>('/health').catch(() => undefined);
if (!health?.ok) {
  process.stderr.write(`No service at ${values.url}. Start it with \`pnpm service\` or \`pnpm demo:judge\`.\n`);
  process.exit(1);
}

/** Cases and private-channel sources visible to one principal. */
async function visibleTo(label: string, principalId: string, keep: (c: CaseView) => boolean): Promise<CaseView[]> {
  const cases = await client.get<CaseView[]>(`/cases?principalId=${encodeURIComponent(principalId)}`);
  const hit = cases.filter(keep);
  say(`cases visible to ${label}: ${hit.map((c) => c.title).join(' | ') || '(none)'}`);
  return hit;
}

if (!values.live) {
  const dir = join(REPO_ROOT, 'data', 'scenarios', 'config-rollback-private');
  say('SYNTHETIC Slack export (data/scenarios/config-rollback-private/sources/slack-export): no workspace is contacted; the live connector stays "awaiting authorization" (use --live with a sandbox workspace).');
  const r = await client.post<ImportRes>('/import', { format: 'scenario-dir', path: dir });
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
    const acc = await visibleTo(name, p.personEntityId, (c) => /ACC-/.test(c.title));
    for (const c of acc.filter((x) => /ACC-30/.test(x.title))) {
      say(`sources of "${c.title}" (private channel):`);
      for (const s of c.sources) say(`  ${s.provider} · ${s.author}: ${s.excerpt}`);
    }
    const inv = await client.post<{ recommendation: { kind: string; text: string }; matches: Array<{ title: string }>; people: Array<{ name: string }> }>('/investigate', {
      text, principal: { id: p.personEntityId, displayName: p.name, groups: p.groups, type: 'human' } satisfies Principal, allowQuestions: false,
    });
    say(`asks: "${text}"`);
    say(`  recommendation (${inv.recommendation.kind}): ${inv.recommendation.text}`);
    say(`  matches: ${inv.matches.map((m) => m.title).join(' | ')}`);
    say(`  people: ${inv.people.map((x) => x.name).join(', ') || '-'}`);
  }
  say('\nThe private-channel case (ACC-30, "Do not roll back N5 units") exists only for channel members: membership comes from the export\'s channel member list and is recorded on the person. Nothing was sent anywhere.');
  process.exit(0);
}

// ---- live, read-only, sandbox only ----
const guard = checkLiveGuard({ live: process.env.KT_SLACK_LIVE, token: process.env.KT_SLACK_TOKEN, workspace: values.workspace, channel: values.channel });
if (!guard.ok) {
  say('Live Slack pull refused. Missing:');
  for (const m of guard.missing) say(`  - ${m}`);
  say('What to set up (sandbox only, read-only):');
  guard.instructions.forEach((line, i) => say(`  ${i + 1}. ${line}`));
  process.exit(2);
}
const token = process.env.KT_SLACK_TOKEN as string; // used only to build the client; never printed or logged
const limit = Math.min(200, Math.max(1, Number(values.limit) || 50));
say(`LIVE read-only pull: workspace "${values.workspace}", channel "${values.channel}", last ${limit} messages. Scopes needed: channels:read, channels:history, groups:read, groups:history, users:read. Nothing is posted; no other channel is read.`);
let pulled;
try {
  pulled = await pullChannelReadOnly(slackWebClient(token), { workspace: values.workspace as string, channel: values.channel as string, limit });
} catch (e) {
  if (e instanceof WorkspaceMismatchError) {
    say(`Stopped: you named workspace "${e.expected}" but the token's workspace is "${e.actual}". Nothing was read beyond auth.test.`);
    process.exit(3);
  }
  if (e instanceof SlackApiError) {
    say(`Stopped: Slack ${e.method} answered "${e.code}" (missing scope, bot not in the channel, or an invalid token). Nothing was imported.`);
    process.exit(3);
  }
  throw e;
}
const { team, channel, messages, users, data, calls } = pulled;
say(`auth.test: team "${team.name}" (${team.id}) matches. Channel #${channel.name} (${channel.id}) is ${channel.is_private ? 'private' : 'public'}, ${channel.members?.length ?? 0} members; ${messages.length} messages read; ${users.length} users for names. Methods called: ${calls.join(', ')}.`);
const connectionId = `slack-live:${team.id}`;
const r = await client.post<ImportRes>('/import', { format: 'slack-live', payload: data, connectionId });
say(`Imported through the slack-export mapping as "${connectionId}": ${r.batch.counts.inserted} new records, ${r.batch.counts.unchangedDuplicates} already known → ${r.cases} cases, ${r.claims} claims, ${r.people} people. ${channel.is_private ? `Private channel: every record is scoped to group slack-channel:${channel.id} and the ${channel.members?.length ?? 0} members got that membership.` : 'Public channel: records are organization-wide.'}`);
try {
  jsonlSink(DEFAULT_ACTIVITY_LOG).write({
    at: new Date().toISOString(), real: new Date().toISOString(), simulated: true, kind: 'evidence',
    text: `Slack live (read-only, sandbox workspace "${team.name}"): #${channel.name} ${channel.is_private ? 'private' : 'public'}, ${messages.length} messages, ${channel.members?.length ?? 0} members → ${r.cases} cases, ${r.claims} claims`,
    why: 'route: slack-live (one channel, read scopes only; nothing posted). This row is real activity, not simulated.',
    detail: { route: 'slack-live', connectionId, channel: channel.id, batchId: r.batch.id, counts: r.batch.counts },
  });
} catch {
  // The activity log is optional.
}

// Access gate: a member vs an outsider.
const directory = await client.get<DirectoryEntry[]>('/directory');
const group = `slack-channel:${channel.id}`;
const members = directory.filter((d) => d.groups.includes(group));
say(`\nDirectory people holding ${group}: ${members.map((m) => m.name).join(', ') || '(none: public channel, or no member has posted yet)'}`);
const member = members[0];
const outsider: Principal = { id: 'person:demo:outsider', displayName: 'Outsider (no groups)', groups: [], type: 'human' };
const fromThisChannel = (c: CaseView): boolean => c.sources.some((s) => s.provider === 'slack' && (s.reference ?? '').includes(`slack://channel/${channel.id}/`));
if (channel.is_private && member) {
  say(`\n== ${member.name} (member)`);
  const mine = await visibleTo(member.name, member.personEntityId, fromThisChannel);
  for (const c of mine) {
    say(`sources of "${c.title}" visible to the member:`);
    for (const s of c.sources.filter((x) => x.provider === 'slack')) say(`  slack · ${s.author}: ${s.excerpt}`);
  }
  say(`\n== ${outsider.displayName}`);
  const leaked = await visibleTo(outsider.displayName, outsider.id, fromThisChannel);
  say(leaked.length ? `UNEXPECTED: the outsider sees cases from the private channel: ${leaked.map((c) => c.title).join(' | ')}` : 'The outsider sees no case built from the private channel.');
  if (!mine.length) say('(No incident case formed from these messages, so there is no timeline to gate; the per-evidence gate still applies to retrieval, people and questions.)');
} else if (!channel.is_private) {
  say('\nPublic channel: its records are organization-wide, so the access gate does not apply; use a private channel to show it.');
} else {
  say('\nNo member of the private channel has a directory entry yet (members get one when they are seen in a message); the gate applies all the same.');
}
say('\nRead-only, one sandbox channel, nothing posted; production Slack would run the same connector under the organisation\'s data policy.');
