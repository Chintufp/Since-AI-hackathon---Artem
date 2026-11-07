import type { FamilySpec } from '../spec.ts';

const spec: FamilySpec = {
  entry: {
    id: 'bgp-linecard-private',
    split: 'validation',
    description: 'BGP and port flaps after a firmware upgrade depend on the line card revision. LC-2 is fixed by a patch (reported twice by different people, then retold in an email); LC-3 needs a vendor workaround recorded only in a private core channel.',
    tags: ['lookalike-different-cause', 'useful-no', 'changed-permissions', 'duplicate-report', 'copied-retelling'],
  },
  people: [
    { slug: 'ville-laakso', name: 'Ville Laakso', role: 'Core Network Engineer', groups: ['core', 'core-private'], slack: 'U801', email: 'ville.laakso@kalevanet.example' },
    { slug: 'pasi-tuomi', name: 'Pasi Tuomi', role: 'Network Engineer', groups: ['core', 'core-private'], slack: 'U802', email: 'pasi.tuomi@kalevanet.example' },
    { slug: 'oskari-nieminen', name: 'Oskari Nieminen', role: 'Core Team Lead', groups: ['core', 'core-private'], slack: 'U803', email: 'oskari.nieminen@kalevanet.example' },
    { slug: 'minna-saarinen', name: 'Minna Saarinen', role: 'Asset Planner', groups: ['planning'], slack: 'U804', email: 'minna.saarinen@kalevanet.example' },
    { slug: 'anssi-heikura', name: 'Anssi Heikura', role: 'NOC Engineer', groups: ['noc'], slack: 'U805', email: 'anssi.heikura@kalevanet.example' },
    { slug: 'rauni-forsman', name: 'Rauni Forsman', role: 'NOC Engineer', groups: ['noc'], slack: 'U806', email: 'rauni.forsman@kalevanet.example' },
  ],
  teams: [
    { id: 't1', inc: 'A', who: 'anssi-heikura', time: '14:08', text: 'Ville, PE-05 BGP sessions to both upstreams are flapping since the 11.2 firmware upgrade at 13:50. The line card ports are logging link flaps too.' },
    { id: 't2', inc: 'A', who: 'ville-laakso', time: '14:10', text: 'Which line card is it? Check the revision.' },
    { id: 't3', inc: 'A', who: 'anssi-heikura', time: '14:12', text: 'LC-2, installed 2020.' },
    { id: 't4', inc: 'A', who: 'ville-laakso', time: '14:15', text: 'That matches the vendor note for 11.2 on LC-2: port flaps until patch 11.2.1 is installed. Pasi, can you put the patch on PE-05? It needs no reload.' },
    { id: 't5', inc: 'A', who: 'pasi-tuomi', time: '14:16', text: 'On it.' },
    { id: 't6', who: 'anssi-heikura', time: '14:20', text: 'Did you see the football last night? That last minute goal was unreal.' },
    { id: 't7', inc: 'A', who: 'pasi-tuomi', time: '14:31', text: 'Patch 11.2.1 installed on PE-05.' },
    { id: 't8', inc: 'A', who: 'anssi-heikura', time: '14:50', text: 'Sessions have been up for 15 minutes, no port flaps.' },
    { id: 't9', inc: 'A', who: 'pasi-tuomi', time: '16:05', text: 'Two hours now and still clean.' },
    { id: 't10', who: 'ville-laakso', time: '16:06', text: 'Good. I will write it up.' },
  ],
  emails: [
    {
      id: 'f08-pe05-writeup',
      inc: 'A',
      copyOf: 't9',
      from: 'ville-laakso',
      to: ['oskari-nieminen', 'pasi-tuomi'],
      cc: ['anssi-heikura'],
      subject: 'PE-05: firmware 11.2 line card flaps fixed by patch 11.2.1',
      body: `Hi,

Write-up for PE-05. After the 11.2 upgrade the BGP sessions and the LC-2 line card ports were flapping. Patch 11.2.1 was installed by Pasi without a reload and Pasi reports the sessions have been clean for two hours.

Ville`,
    },
  ],
  slackChannels: [
    { name: 'noc-alerts', members: ['rauni-forsman', 'anssi-heikura', 'ville-laakso', 'pasi-tuomi', 'oskari-nieminen', 'minna-saarinen'] },
    { name: 'core-private', private: true, members: ['ville-laakso', 'pasi-tuomi', 'oskari-nieminen'] },
  ],
  slack: [
    { id: 's1', channel: 'noc-alerts', day: '2026-08-04', time: '14:11:00', who: 'rauni-forsman', inc: 'A', text: 'PE-05 BGP is going down and up repeatedly since the upgrade, I have opened a ticket.' },
    { id: 's2', channel: 'noc-alerts', day: '2026-08-04', time: '15:00:00', who: 'anssi-heikura', text: 'The coffee machine on floor 2 is broken again, use the one in the lobby.' },
    { id: 's3', channel: 'core-private', day: '2026-08-11', time: '09:00:00', who: 'ville-laakso', inc: 'B', text: 'PE-09 is flapping after 11.2 but it has LC-3, so 11.2.1 should not be the answer. The vendor advisory, still under NDA, says LC-3 is affected through the BFD default.' },
    { id: 's4', channel: 'core-private', day: '2026-08-11', time: '09:25:00', who: 'pasi-tuomi', inc: 'B', thread: 's3', text: 'I installed 11.2.1 on PE-09 anyway. No change.' },
    { id: 's5', channel: 'core-private', day: '2026-08-11', time: '09:50:00', who: 'ville-laakso', inc: 'B', thread: 's3', text: 'Vendor workaround: set the BFD interval to 300 ms on the affected sessions and it holds.' },
    { id: 's6', channel: 'core-private', day: '2026-08-11', time: '10:20:00', who: 'pasi-tuomi', inc: 'B', thread: 's3', text: 'BFD interval raised on PE-09, the sessions are stable.' },
    { id: 's7', channel: 'core-private', day: '2026-08-11', time: '10:30:00', who: 'oskari-nieminen', thread: 's3', text: 'Please do not share the advisory outside core until the vendor publishes it.' },
  ],
  entities: [
    { name: 'PE-05', type: 'asset', attributes: { 'unit.revision': 'LC-2', 'unit.installed_year': 2020, 'software.version': '11.2' } },
    { name: 'PE-09', type: 'asset', attributes: { 'unit.revision': 'LC-3', 'unit.installed_year': 2022, 'software.version': '11.2' } },
    { name: 'PE-12', type: 'asset', attributes: { 'unit.revision': 'LC-3', 'unit.installed_year': 2023, 'software.version': '11.2' } },
  ],
  incidents: [
    {
      key: 'A',
      title: 'PE-05 BGP and port flaps after firmware 11.2 on LC-2, fixed by patch 11.2.1',
      realCause: 'Firmware 11.2 causes port flaps on LC-2 line cards until patch 11.2.1 is installed.',
      claims: [
        { type: 'observation', statement: 'PE-05 BGP sessions to both upstreams flap and line card ports log link flaps after the 11.2 upgrade', by: 'anssi-heikura' },
        { type: 'condition', statement: 'PE-05 has an LC-2 line card installed in 2020', by: 'anssi-heikura' },
        { type: 'advice', statement: 'Install patch 11.2.1 which fixes port flaps on LC-2 under firmware 11.2 and needs no reload', by: 'ville-laakso' },
        { type: 'action', statement: 'Pasi installed patch 11.2.1 on PE-05', by: 'pasi-tuomi' },
        { type: 'outcome', statement: 'PE-05 sessions stayed up with no port flaps for two hours after the patch', by: 'pasi-tuomi' },
      ],
      attempts: [{ action: 'patch.install', by: 'pasi-tuomi', performed: true }],
      outcome: { result: 'recovered', lasting: 'unknown', reportedBy: 'pasi-tuomi' },
      knowledge: {
        'anssi-heikura': { knows: ['unit.revision', 'bgp.session'], canObserve: ['bgp.session', 'alarms.state'] },
        'rauni-forsman': { knows: ['bgp.session'], canObserve: ['bgp.session', 'alarms.state'] },
        'ville-laakso': { knows: ['reasoning behind the patch advice', 'unit.revision'], canObserve: [] },
        'pasi-tuomi': { knows: ['action.performed'], canObserve: ['bgp.session'] },
        'minna-saarinen': { knows: ['unit.revision'], canObserve: ['unit.revision', 'unit.installed_year'] },
      },
      accessGroups: ['noc', 'core', 'planning'],
    },
    {
      key: 'B',
      title: 'PE-09 flaps after 11.2 on LC-3; patch does not help, BFD interval workaround',
      realCause: 'On LC-3 the 11.2 BFD default is too aggressive; patch 11.2.1 does not address it, raising the BFD interval to 300 ms does (vendor advisory under NDA).',
      claims: [
        { type: 'observation', statement: 'PE-09 with LC-3 flaps after the 11.2 upgrade', by: 'ville-laakso' },
        { type: 'action', statement: 'Pasi installed patch 11.2.1 on PE-09 with no change', by: 'pasi-tuomi' },
        { type: 'advice', statement: 'Set the BFD interval to 300 ms on the affected sessions as the vendor workaround for LC-3', by: 'ville-laakso' },
        { type: 'action', statement: 'Pasi raised the BFD interval on PE-09', by: 'pasi-tuomi' },
        { type: 'outcome', statement: 'PE-09 sessions are stable after the BFD interval change', by: 'pasi-tuomi' },
      ],
      attempts: [
        { action: 'patch.install', by: 'pasi-tuomi', performed: true },
        { action: 'config.change', by: 'pasi-tuomi', performed: true },
      ],
      outcome: { result: 'recovered', lasting: 'unknown', reportedBy: 'pasi-tuomi' },
      knowledge: {
        'ville-laakso': { knows: ['unit.revision', 'config.changed', 'reasoning behind the BFD workaround'], canObserve: [] },
        'pasi-tuomi': { knows: ['action.performed', 'config.changed'], canObserve: ['bgp.session'] },
        'oskari-nieminen': { knows: [], canObserve: [] },
      },
      accessGroups: ['core-private'],
    },
  ],
  problems: [
    {
      id: 'bgp-linecard-private-p1',
      requester: 'rauni-forsman',
      text: 'PE-12 BGP sessions are flapping since the 11.2 upgrade. Should we install patch 11.2.1 like on PE-05?',
      observations: [
        { key: 'bgp.session', value: 'flapping', label: 'BGP sessions flapping' },
        { key: 'software.version', value: '11.2', label: 'Firmware 11.2' },
      ],
      key: {
        relatedIncidentKeys: ['A', 'B'],
        applicable: 'inapplicable',
        consequentialGap: { description: 'Is PE-12 an LC-2 line card? The patch advice is for LC-2 only. The real LC-3 workaround lives in a private channel this requester cannot see.', answerers: ['minna-saarinen'], answer: 'no' },
        answers: {
          'minna-saarinen': { 'unit.revision=LC-2': 'no', 'unit.revision=LC-3': 'yes' },
          'anssi-heikura': { 'unit.revision=LC-2': 'unknown' },
          'pasi-tuomi': { 'unit.revision=LC-2': 'unknown' },
        },
        noQuestionNeeded: false,
        expectedRecommendation: 'none',
        distinguishingConditions: [{ key: 'unit.revision', value: 'LC-3' }],
        laterOutcome: 'unknown',
      },
    },
    {
      id: 'bgp-linecard-private-p2',
      requester: 'ville-laakso',
      text: 'PE-12 has LC-3 and is flapping after 11.2. What did we do on PE-09?',
      observations: [
        { key: 'bgp.session', value: 'flapping', label: 'BGP sessions flapping' },
        { key: 'unit.revision', value: 'LC-3', label: 'LC-3 line card' },
        { key: 'software.version', value: '11.2', label: 'Firmware 11.2' },
      ],
      key: {
        relatedIncidentKeys: ['B'],
        applicable: 'qualified',
        answers: {},
        noQuestionNeeded: true,
        expectedRecommendation: 'qualified',
        laterOutcome: 'recovered',
      },
    },
    {
      id: 'bgp-linecard-private-p3',
      requester: 'rauni-forsman',
      text: 'Can I close my PE-05 BGP ticket? Pasi said the sessions were clean for two hours after the patch.',
      key: {
        relatedIncidentKeys: ['A'],
        applicable: 'qualified',
        consequentialGap: { description: 'Are the PE-05 sessions still up now? Only a two-hour clean window was reported, by one person, on the day of the patch.', answerers: ['anssi-heikura'], answer: 'yes' },
        answers: {
          'anssi-heikura': { 'bgp.session=up': 'yes' },
          'pasi-tuomi': { 'bgp.session=up': 'unknown' },
        },
        noQuestionNeeded: false,
        expectedRecommendation: 'qualified',
        laterOutcome: 'recovered',
      },
    },
  ],
};

export default spec;
