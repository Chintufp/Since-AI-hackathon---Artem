import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KnowledgeStore, PeopleDirectory } from '../../libs/utils/contracts/index.ts';
import type { SlackExportData } from '../../libs/utils/connectors/index.ts';
import { storeDirectory } from '../../libs/utils/investigation/directory.ts';
import { importFromPath, listCases, openStore } from '../../libs/utils/memory/index.ts';
import { applyDirectory } from './directory.ts';

const ORG = 'org1';
const NOW = '2026-11-07T00:00:00Z';
const GROUP = 'slack-channel:CPRIV';

const user = (id: string, name: string) => ({ id, name: name.toLowerCase(), real_name: name });
const ts = (n: number) => `1783${String(600000 + n)}.000100`;

/** A private channel with an incident thread: two posters, plus (optionally) a listed member who never posts. */
function data(members: string[] | undefined): SlackExportData {
  return {
    users: [user('U1', 'Alice Anders'), user('U2', 'Bob Berg'), user('U3', 'Cecil Quiet'), user('U4', 'Dana Outside')],
    channels: [{ id: 'CPRIV', name: 'secret-room', is_private: true, ...(members ? { members } : {}) }],
    days: [{
      channel: 'secret-room', date: '2026-07-09',
      messages: [
        { ts: ts(1), user: 'U1', text: 'Unit U-77 at site Alpha lost its link and keeps flapping since the morning.' },
        { ts: ts(2), user: 'U2', text: 'Unit U-77 flapping again; replaced the patch cable at site Alpha, link is stable now.' },
      ],
    }],
  };
}

const dir = (groups: Record<string, string[]>): PeopleDirectory => ({
  people: [
    { id: 'person:directory:alice', name: 'Alice Anders', role: 'engineer', groups: groups.alice ?? ['ops'], actorIds: ['person:slack:U1'], available: true },
    { id: 'person:directory:bob', name: 'Bob Berg', role: 'engineer', groups: groups.bob ?? ['ops'], actorIds: ['person:slack:U2'], available: true },
    { id: 'person:directory:cecil', name: 'Cecil Quiet', role: 'engineer', groups: groups.cecil ?? ['ops'], actorIds: ['person:slack:U3'], available: true },
    { id: 'person:directory:dana', name: 'Dana Outside', role: 'engineer', groups: groups.dana ?? ['ops'], actorIds: ['person:slack:U4'], available: true },
  ],
});

const groupsOf = (s: KnowledgeStore, actor: string): string[] => {
  const d = storeDirectory(s);
  return d.get(d.resolve(actor)!)?.groups ?? [];
};
const casesFor = (s: KnowledgeStore, actor: string): number => listCases(s, { id: actor, groups: groupsOf(s, actor) }).length;
const imp = (s: KnowledgeStore, d: SlackExportData) => importFromPath(s, { format: 'slack-export', payload: d, orgId: ORG, now: NOW });

for (const withDirectory of [false, true]) {
  for (const members of [['U1', 'U2', 'U3'], undefined]) {
    test(`private channel membership: members see it, outsiders do not (directory ${withDirectory}, members ${members ? 'listed' : 'from posters'})`, () => {
      const s = openStore(':memory:');
      imp(s, data(members));
      if (withDirectory) applyDirectory(s, ORG, dir({}));
      const before = casesFor(s, 'person:slack:U1');
      assert.ok(before > 0, 'the channel produced at least one case');
      assert.equal(casesFor(s, 'person:slack:U1'), before);
      assert.equal(casesFor(s, 'person:slack:U2'), before, 'every posting member sees the records');
      assert.ok(groupsOf(s, 'person:slack:U1').includes(GROUP) && groupsOf(s, 'person:slack:U2').includes(GROUP));
      if (members) assert.equal(casesFor(s, 'person:slack:U3'), before, 'a listed member who never posted sees them too');
      else assert.equal(groupsOf(s, 'person:slack:U3').includes(GROUP), false, 'a non-poster not listed as member gets no grant');
      if (withDirectory) {
        assert.equal(casesFor(s, 'person:slack:U4'), 0, 'a directory person outside the channel sees nothing');
        assert.ok(groupsOf(s, 'person:slack:U1').includes('ops'), 'directory groups kept');
      }
      assert.equal(listCases(s, { id: 'anon', groups: [] }).length, 0);
      assert.equal(listCases(s, { id: 'anon', groups: ['ops'] }).length, 0);
    });
  }
}

test('applyDirectory merges directory groups with channel memberships and is idempotent', () => {
  const s = openStore(':memory:');
  imp(s, data(['U1', 'U2']));
  applyDirectory(s, ORG, dir({ alice: ['ops', 'core'] }));
  const first = groupsOf(s, 'person:slack:U1').slice().sort();
  assert.deepEqual(first, ['core', 'ops', GROUP]);
  // the directory is the authority for organization groups: dropping one removes it, the channel group stays
  applyDirectory(s, ORG, dir({ alice: ['ops'] }));
  assert.deepEqual(groupsOf(s, 'person:slack:U1').slice().sort(), ['ops', GROUP]);
  // re-import and re-apply change nothing
  const snap = JSON.stringify(s.list('entity'));
  imp(s, data(['U1', 'U2']));
  applyDirectory(s, ORG, dir({ alice: ['ops'] }));
  assert.equal(JSON.stringify(s.list('entity')), snap);
  assert.equal(s.list('entity', { where: { type: 'person' } }).filter((e) => e.name === 'Alice Anders').length, 1);
});

test('a directory person cannot gain groups beyond directory plus derived memberships', () => {
  const s = openStore(':memory:');
  imp(s, data(['U1', 'U2']));
  applyDirectory(s, ORG, dir({}));
  assert.deepEqual(groupsOf(s, 'person:slack:U4'), ['ops']);
  assert.deepEqual(groupsOf(s, 'person:slack:U3').sort(), ['ops']);
});
