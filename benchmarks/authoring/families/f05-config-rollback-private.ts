import type { FamilySpec } from '../spec.ts';

const spec: FamilySpec = {
  entry: {
    id: 'config-rollback-private',
    split: 'train',
    description: 'A config template push breaks the voice VLAN on access switches. Rolling back works on the old model; on a newer model it fails, and that lesson sits in a private change-review channel the junior NOC engineer cannot see.',
    tags: ['changed-permissions', 'wrong-recipient-trap', 'copied-retelling', 'conflicting-conditions', 'useful-no'],
  },
  people: [
    { slug: 'jarmo-heikkinen', name: 'Jarmo Heikkinen', role: 'Access Network Engineer', groups: ['access', 'change-board'], slack: 'U501', email: 'jarmo.heikkinen@kalevanet.example' },
    { slug: 'sirkka-lindholm', name: 'Sirkka Lindholm', role: 'Senior Network Engineer', groups: ['core', 'access', 'change-board'], slack: 'U502', email: 'sirkka.lindholm@kalevanet.example' },
    { slug: 'antti-korhonen', name: 'Antti Korhonen', role: 'NOC Engineer', groups: ['noc', 'change-board'], slack: 'U503', email: 'antti.korhonen@kalevanet.example' },
    { slug: 'tuula-salmi', name: 'Tuula Salmi', role: 'Change Manager', groups: ['planning', 'change-board'], slack: 'U504', email: 'tuula.salmi@kalevanet.example' },
    { slug: 'elina-mattila', name: 'Elina Mattila', role: 'Junior NOC Engineer', groups: ['noc'], slack: 'U505', email: 'elina.mattila@kalevanet.example' },
  ],
  teams: [
    { id: 't1', inc: 'A', who: 'antti-korhonen', time: '13:02', text: 'Jarmo, voice VLAN 210 dropped on ACC-12 about ten minutes after the template v7 push. Phones on floor 3 are offline. The data VLAN is fine.' },
    { id: 't2', inc: 'A', who: 'jarmo-heikkinen', time: '13:04', text: 'Which switch model is ACC-12?' },
    { id: 't3', inc: 'A', who: 'antti-korhonen', time: '13:05', text: 'The old one, N3, installed 2019.' },
    { id: 't4', inc: 'A', who: 'jarmo-heikkinen', time: '13:08', text: "v7 changed the voice VLAN range. Tuula approved the change last week so it was meant to be safe, but let's roll ACC-12 back to the v6 template." },
    { id: 't5', who: 'antti-korhonen', time: '13:09', text: 'Do I do it or do you?' },
    { id: 't6', who: 'jarmo-heikkinen', time: '13:10', text: "I'll do it from the controller, give me five minutes." },
    { id: 't7', inc: 'A', who: 'jarmo-heikkinen', time: '13:17', text: 'Rolled back to v6 and saved it to the startup config. VLAN 210 is back on all ports.' },
    { id: 't8', inc: 'A', who: 'antti-korhonen', time: '13:20', text: 'Phones are registering again, confirmed on floor 3.' },
    { id: 't9', who: 'antti-korhonen', time: '13:21', text: 'Did you see the email about the sauna evening? It is on again.' },
    { id: 't10', who: 'jarmo-heikkinen', time: '13:22', text: 'Ha, yes. I will write the change note.' },
  ],
  emails: [
    {
      id: 'f05-change-note-acc12',
      inc: 'A',
      copyOf: 't7',
      from: 'jarmo-heikkinen',
      to: ['antti-korhonen'],
      cc: ['tuula-salmi'],
      date: 'Thu, 02 Jul 2026 14:05:00 +0300',
      subject: 'Change note: ACC-12 template v7 rolled back',
      body: `Hi,

Change note for the record. Template v7 broke voice VLAN 210 on ACC-12. The switch was rolled back to the v6 template and the config was saved to startup. VLAN 210 is back and the phones on floor 3 registered again.

Jarmo`,
    },
  ],
  slackChannels: [
    { name: 'change-review', private: true, members: ['sirkka-lindholm', 'tuula-salmi', 'jarmo-heikkinen', 'antti-korhonen'] },
    { name: 'noc-general', members: ['elina-mattila', 'antti-korhonen', 'jarmo-heikkinen', 'sirkka-lindholm', 'tuula-salmi'] },
  ],
  slack: [
    { id: 's1', channel: 'change-review', day: '2026-07-09', time: '09:00:00', who: 'antti-korhonen', inc: 'B', text: "ACC-30 lost voice VLAN 210 after v7, same as ACC-12 last week. It's an N5 though." },
    { id: 's2', channel: 'change-review', day: '2026-07-09', time: '09:05:00', who: 'jarmo-heikkinen', inc: 'B', thread: 's1', text: 'Rolled it back to v6 like on ACC-12. Now the uplink ports are down. v6 has no profile for the N5 port layout.' },
    { id: 's3', channel: 'change-review', day: '2026-07-09', time: '09:12:00', who: 'sirkka-lindholm', inc: 'B', thread: 's1', text: 'Do not roll back N5 units. The v6 template cannot address their port layout. Apply the v7.1 patch that fixes the voice range typo instead.' },
    { id: 's4', channel: 'change-review', day: '2026-07-09', time: '09:40:00', who: 'jarmo-heikkinen', inc: 'B', thread: 's1', text: 'v7.1 patch applied on ACC-30. Uplinks and VLAN 210 are back.' },
    { id: 's5', channel: 'change-review', day: '2026-07-09', time: '09:45:00', who: 'tuula-salmi', thread: 's1', text: 'Please add it to the change record. I will hold v7 for the remaining N5 units until v7.1 is rolled out.' },
    { id: 's6', channel: 'noc-general', day: '2026-07-09', time: '10:30:00', who: 'antti-korhonen', text: 'Reminder: the network maintenance window on Saturday is 02:00 to 04:00, expect brief blips on the guest wifi.' },
  ],
  entities: [
    { name: 'ACC-12', type: 'asset', attributes: { 'unit.model': 'N3', 'unit.installed_year': 2019 } },
    { name: 'ACC-30', type: 'asset', attributes: { 'unit.model': 'N5', 'unit.installed_year': 2024 } },
    { name: 'ACC-33', type: 'asset', attributes: { 'unit.model': 'N5', 'unit.installed_year': 2024 } },
    { name: 'config template v7', type: 'software', attributes: {} },
  ],
  incidents: [
    {
      key: 'A',
      title: 'ACC-12 voice VLAN lost after template v7, rolled back to v6',
      realCause: 'Template v7 contained a typo in the voice VLAN range.',
      claims: [
        { type: 'observation', statement: 'Voice VLAN 210 dropped on ACC-12 about ten minutes after the template v7 push while the data VLAN stayed fine', by: 'antti-korhonen' },
        { type: 'condition', statement: 'ACC-12 is an N3 model installed in 2019', by: 'antti-korhonen' },
        { type: 'hypothesis', statement: 'Template v7 changed the voice VLAN range', by: 'jarmo-heikkinen' },
        { type: 'advice', statement: 'Roll ACC-12 back to the v6 template', by: 'jarmo-heikkinen' },
        { type: 'action', statement: 'Jarmo rolled ACC-12 back to v6 and saved it to the startup config', by: 'jarmo-heikkinen' },
        { type: 'outcome', statement: 'VLAN 210 is back on all ports and phones on floor 3 registered again', by: 'antti-korhonen' },
      ],
      attempts: [{ action: 'config.rollback', by: 'jarmo-heikkinen', performed: true }],
      outcome: { result: 'recovered', lasting: 'unknown', reportedBy: 'antti-korhonen' },
      knowledge: {
        'antti-korhonen': { knows: ['unit.model', 'traffic.state', 'config.changed'], canObserve: ['traffic.state'] },
        'jarmo-heikkinen': { knows: ['config.saved_startup', 'config.rollback_supported', 'action.performed'], canObserve: ['config.saved_startup'] },
        'tuula-salmi': { knows: [], canObserve: [] },
      },
      accessGroups: ['noc', 'access'],
    },
    {
      key: 'B',
      title: 'ACC-30 voice VLAN lost after v7; rollback to v6 fails on the N5 model',
      realCause: 'v7 voice range typo. v6 has no profile for the N5 port layout, so the rollback took the uplinks down; the v7.1 patch fixed it.',
      claims: [
        { type: 'observation', statement: 'ACC-30 lost voice VLAN 210 after template v7, an N5 model', by: 'antti-korhonen' },
        { type: 'action', statement: 'Jarmo rolled ACC-30 back to v6 which took the uplink ports down', by: 'jarmo-heikkinen' },
        { type: 'condition', statement: 'The v6 template has no profile for the N5 port layout', by: 'jarmo-heikkinen' },
        { type: 'advice', statement: 'Do not roll back N5 units, apply the v7.1 patch that fixes the voice range typo', by: 'sirkka-lindholm' },
        { type: 'action', statement: 'Jarmo applied the v7.1 patch on ACC-30', by: 'jarmo-heikkinen' },
        { type: 'outcome', statement: 'Uplinks and VLAN 210 are back on ACC-30 after the v7.1 patch', by: 'jarmo-heikkinen' },
      ],
      attempts: [
        { action: 'config.rollback', by: 'jarmo-heikkinen', performed: true },
        { action: 'config.patch', by: 'jarmo-heikkinen', performed: true },
      ],
      outcome: { result: 'recovered', lasting: 'unknown', reportedBy: 'jarmo-heikkinen' },
      knowledge: {
        'antti-korhonen': { knows: ['unit.model', 'traffic.state'], canObserve: ['traffic.state'] },
        'jarmo-heikkinen': { knows: ['config.rollback_supported', 'config.saved_startup', 'action.performed'], canObserve: ['config.saved_startup'] },
        'sirkka-lindholm': { knows: ['config.rollback_supported', 'reasoning behind the patch advice'], canObserve: ['config.rollback_supported'] },
        'tuula-salmi': { knows: [], canObserve: [] },
      },
      accessGroups: ['change-board'],
    },
  ],
  problems: [
    {
      id: 'config-rollback-private-p1',
      requester: 'elina-mattila',
      text: 'ACC-33 is an N5 and lost voice VLAN 210 after the template v7 push. Can I roll it back to v6 like Jarmo did on ACC-12?',
      observations: [
        { key: 'unit.model', value: 'N5', label: 'N5 model' },
        { key: 'config.changed', value: true, label: 'Template v7 pushed' },
      ],
      key: {
        relatedIncidentKeys: ['A', 'B'],
        applicable: 'inapplicable',
        consequentialGap: { description: 'Does the v6 template support the N5 port layout? The answer is only in the change-review record, which this requester cannot see.', answerers: ['sirkka-lindholm', 'jarmo-heikkinen'], answer: 'no' },
        answers: {
          'sirkka-lindholm': { 'config.rollback_supported=true': 'no' },
          'jarmo-heikkinen': { 'config.rollback_supported=true': 'no' },
          'tuula-salmi': { 'config.rollback_supported=true': 'unknown' },
          'antti-korhonen': { 'config.rollback_supported=true': 'unknown' },
        },
        noQuestionNeeded: false,
        expectedRecommendation: 'none',
        // the requester already observed unit.model=N5; the unobserved decisive condition is rollback support
        distinguishingConditions: [{ key: 'config.rollback_supported', value: false }],
        laterOutcome: 'unknown',
      },
    },
    {
      id: 'config-rollback-private-p2',
      requester: 'antti-korhonen',
      text: 'ACC-33 is an N5 and lost voice VLAN 210 after the v7 push. Roll back to v6?',
      observations: [
        { key: 'unit.model', value: 'N5', label: 'N5 model' },
        { key: 'config.changed', value: true, label: 'Template v7 pushed' },
      ],
      key: {
        relatedIncidentKeys: ['A', 'B'],
        applicable: 'qualified',
        answers: {},
        noQuestionNeeded: true,
        expectedRecommendation: 'qualified',
        distinguishingConditions: [{ key: 'unit.model', value: 'N5' }],
        laterOutcome: 'recovered',
      },
    },
    {
      id: 'config-rollback-private-p3',
      requester: 'elina-mattila',
      text: 'On ACC-12 the v6 rollback was done by Jarmo. Was it saved to the startup config or would a reboot bring v7 back? Tuula approved the original change so she can tell me, right?',
      key: {
        relatedIncidentKeys: ['A'],
        applicable: 'qualified',
        answers: {
          'jarmo-heikkinen': { 'config.saved_startup=true': 'yes' },
          'tuula-salmi': { 'config.saved_startup=true': 'unknown' },
        },
        noQuestionNeeded: true,
        expectedRecommendation: 'qualified',
        laterOutcome: 'recovered',
      },
    },
  ],
};

export default spec;
