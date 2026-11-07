import type { FamilySpec } from '../spec.ts';

const spec: FamilySpec = {
  entry: {
    id: 'transponder-laser',
    split: 'test',
    description: 'Optical module replaced on a transport node: local link up, far-end loss of signal. A line card power cycle is advised but the outcome is never reported. A colleague mentioned as an expert only handled an older equipment family.',
    tags: ['missing-outcome', 'wrong-recipient-trap', 'conflicting-conditions', 'duplicate-report', 'lookalike-different-cause'],
  },
  people: [
    { slug: 'joonas-kemppainen', name: 'Joonas Kemppainen', role: 'Field Engineer', groups: ['field'], slack: 'U901', email: 'joonas.kemppainen@kalevanet.example' },
    { slug: 'helena-ketola', name: 'Helena Ketola', role: 'Transport Expert', groups: ['transport', 'noc'], slack: 'U902', email: 'helena.ketola@kalevanet.example' },
    { slug: 'ismo-vainio', name: 'Ismo Vainio', role: 'NOC Engineer', groups: ['noc'], slack: 'U903', email: 'ismo.vainio@kalevanet.example' },
    { slug: 'jaana-peltonen', name: 'Jaana Peltonen', role: 'Field Team Lead', groups: ['field'], slack: 'U904', email: 'jaana.peltonen@kalevanet.example' },
    { slug: 'pentti-laitinen', name: 'Pentti Laitinen', role: 'Inventory Planner', groups: ['planning'], slack: 'U905', email: 'pentti.laitinen@kalevanet.example' },
    { slug: 'tiina-aho', name: 'Tiina Aho', role: 'NOC Engineer', groups: ['noc'], slack: 'U906', email: 'tiina.aho@kalevanet.example' },
  ],
  teams: [
    { id: 't1', inc: 'A', who: 'joonas-kemppainen', time: '11:02', text: "Helena, I replaced the QSFP on XC-318. The port comes up locally but there is no traffic and the LOS alarm is still lit on the far end." },
    { id: 't2', inc: 'A', who: 'helena-ketola', time: '11:05', text: 'Is the far-end alarm active now or cleared? Sometimes it takes a minute.' },
    { id: 't3', inc: 'A', who: 'joonas-kemppainen', time: '11:07', text: 'Still active on the far end. The local end says link up.' },
    { id: 't4', inc: 'A', who: 'helena-ketola', time: '11:10', text: 'Asymmetric then. On the XC-4 line cards from 2021, revision C, the transmit laser stays disabled after a hot swap until the card is power cycled. Which revision is yours?' },
    { id: 't5', inc: 'A', who: 'joonas-kemppainen', time: '11:12', text: 'Revision C, installed 2021.' },
    { id: 't6', inc: 'A', who: 'helena-ketola', time: '11:14', text: 'Power cycle the line card from the controller. Only that card, not the whole shelf. Jaana did something similar on the XC-2 units last year if you need more details.' },
    { id: 't7', inc: 'A', who: 'joonas-kemppainen', time: '11:16', text: 'OK, power cycling card 3 now.' },
    { id: 't8', who: 'ismo-vainio', time: '11:20', text: 'Heads up all, the VPN has been slow all morning.' },
    { id: 't9', inc: 'A', who: 'joonas-kemppainen', time: '11:22', text: 'The card is rebooting, it takes about ten minutes.' },
    { id: 't10', inc: 'A', who: 'helena-ketola', time: '11:45', text: 'Let me know how it goes.' },
  ],
  emails: [
    {
      id: 'f09-xc2-reseat',
      inc: 'B',
      from: 'jaana-peltonen',
      to: ['helena-ketola'],
      cc: ['pentti-laitinen'],
      date: 'Tue, 18 Nov 2025 15:40:00 +0200',
      subject: 'XC-122 optic replacement: line card reseat',
      body: `Hi Helena,

For your notes. XC-122 is an XC-2 node installed in 2018. After the optic was replaced there was no traffic. We reseated the line card and traffic came back straight away. It has been stable for the three months since. We never needed a power cycle on the XC-2.

Jaana`,
    },
  ],
  slackChannels: [{ name: 'noc', members: ['ismo-vainio', 'tiina-aho', 'helena-ketola', 'joonas-kemppainen', 'jaana-peltonen', 'pentti-laitinen'] }],
  slack: [
    { id: 's1', channel: 'noc', day: '2026-09-15', time: '11:08:00', who: 'ismo-vainio', inc: 'A', text: 'XC-318 far end has shown LOS since 10:55, is anyone on it?' },
    { id: 's2', channel: 'noc', day: '2026-09-15', time: '11:09:00', who: 'tiina-aho', inc: 'A', text: 'I see the same LOS on XC-318, I have opened a ticket.' },
    { id: 's3', channel: 'noc', day: '2026-09-15', time: '12:00:00', who: 'pentti-laitinen', text: 'Stock take on Friday: please return unused spare modules to the cage.' },
  ],
  entities: [
    { name: 'XC-318', type: 'asset', attributes: { 'unit.model': 'XC-4', 'unit.installed_year': 2021, 'unit.revision': 'C' } },
    { name: 'XC-122', type: 'asset', attributes: { 'unit.model': 'XC-2', 'unit.installed_year': 2018 } },
    { name: 'XC-325', type: 'asset', attributes: { 'unit.model': 'XC-4', 'unit.installed_year': 2021, 'unit.revision': 'C' } },
  ],
  incidents: [
    {
      key: 'A',
      title: 'XC-318 far-end LOS after QSFP replacement; line card power cycle advised',
      realCause: 'On XC-4 revision C line cards the transmit laser stays disabled after a hot swap until the card is power cycled.',
      claims: [
        { type: 'observation', statement: 'After the QSFP replacement the XC-318 port is up locally but the far end still shows LOS and there is no traffic', by: 'joonas-kemppainen' },
        { type: 'condition', statement: 'XC-318 line card is an XC-4 revision C installed in 2021', by: 'joonas-kemppainen' },
        { type: 'hypothesis', statement: 'On XC-4 revision C cards the transmit laser stays disabled after a hot swap until the card is power cycled', by: 'helena-ketola' },
        { type: 'advice', statement: 'Power cycle only the line card from the controller and not the whole shelf', by: 'helena-ketola' },
        { type: 'action', statement: 'Joonas power cycled card 3 on XC-318', by: 'joonas-kemppainen' },
      ],
      attempts: [
        { action: 'sfp.replace', by: 'joonas-kemppainen', performed: true },
        { action: 'power.cycle', by: 'joonas-kemppainen', performed: true },
        { action: 'power.cycle.shelf', by: 'joonas-kemppainen', performed: false },
      ],
      outcome: { result: 'unknown', lasting: 'unknown' },
      knowledge: {
        'joonas-kemppainen': { knows: ['traffic.state', 'unit.revision', 'action.performed'], canObserve: [] },
        'helena-ketola': { knows: ['reasoning behind the power cycle advice', 'power.scope'], canObserve: ['traffic.state'] },
        'ismo-vainio': { knows: [], canObserve: ['traffic.state', 'alarms.state'] },
        'tiina-aho': { knows: [], canObserve: ['traffic.state', 'alarms.state'] },
        'pentti-laitinen': { knows: ['unit.revision', 'unit.installed_year'], canObserve: ['unit.revision', 'unit.installed_year'] },
        'jaana-peltonen': { knows: [], canObserve: [] },
      },
      accessGroups: ['noc', 'field', 'transport', 'planning'],
    },
    {
      key: 'B',
      title: 'XC-122 (XC-2) no traffic after optic replacement; line card reseat',
      realCause: 'XC-2 family: line card needed a reseat after the optic swap. A different mechanism from the XC-4 laser state.',
      claims: [
        { type: 'condition', statement: 'XC-122 is an XC-2 node installed in 2018', by: 'jaana-peltonen' },
        { type: 'observation', statement: 'After the optic replacement XC-122 had no traffic', by: 'jaana-peltonen' },
        { type: 'action', statement: 'The line card on XC-122 was reseated', by: 'jaana-peltonen' },
        { type: 'outcome', statement: 'Traffic came back straight away and XC-122 has been stable for three months', by: 'jaana-peltonen' },
        { type: 'observation', statement: 'XC-2 units never needed a power cycle', by: 'jaana-peltonen' },
      ],
      attempts: [
        { action: 'sfp.replace', by: 'jaana-peltonen', performed: true },
        { action: 'card.reseat', by: 'jaana-peltonen', performed: true },
      ],
      outcome: { result: 'recovered', lasting: 'confirmed', reportedBy: 'jaana-peltonen' },
      knowledge: {
        'jaana-peltonen': { knows: ['traffic.state', 'unit.model', 'action.performed'], canObserve: [] },
        'helena-ketola': { knows: ['power.scope'], canObserve: ['traffic.state'] },
      },
      accessGroups: ['field', 'transport', 'noc', 'planning'],
    },
  ],
  problems: [
    {
      id: 'transponder-laser-p1',
      requester: 'tiina-aho',
      text: 'XC-325 is an XC-4 revision C from 2021. The QSFP was replaced, the local port is up, far end shows LOS. Is the power cycle that Helena advised on XC-318 the right move?',
      observations: [
        { key: 'interface.status', value: 'up', label: 'Local port up' },
        { key: 'alarms.state', value: 'active', label: 'Far-end LOS active' },
        { key: 'unit.model', value: 'XC-4', label: 'XC-4 line card' },
        { key: 'unit.revision', value: 'C', label: 'Revision C' },
        { key: 'unit.installed_year', value: 2021, label: 'Installed 2021' },
      ],
      key: {
        relatedIncidentKeys: ['A'],
        applicable: 'qualified',
        consequentialGap: { description: 'Did the power cycle on XC-318 actually restore traffic? The outcome was never reported.', answerers: ['joonas-kemppainen'], answer: 'yes' },
        answers: {
          'joonas-kemppainen': { 'traffic.state=flowing@XC-318': 'yes' },
          'helena-ketola': { 'traffic.state=flowing@XC-318': 'unknown' },
          'jaana-peltonen': { 'traffic.state=flowing@XC-318': 'unknown' },
        },
        noQuestionNeeded: false,
        expectedRecommendation: 'reuse',
        laterOutcome: 'recovered',
      },
    },
    {
      id: 'transponder-laser-p2',
      requester: 'ismo-vainio',
      text: 'XC-122 is an XC-2 node from 2018. The optic was replaced and there is no traffic. Do the same as XC-318, a card power cycle?',
      observations: [
        { key: 'unit.model', value: 'XC-2', label: 'XC-2 node' },
        { key: 'unit.installed_year', value: 2018, label: 'Installed 2018' },
        { key: 'traffic.state', value: 'absent', label: 'No traffic' },
      ],
      key: {
        relatedIncidentKeys: ['B'],
        applicable: 'reuse',
        answers: {},
        noQuestionNeeded: true,
        expectedRecommendation: 'reuse',
        distinguishingConditions: [{ key: 'unit.model', value: 'XC-2' }],
        laterOutcome: 'recovered',
      },
    },
    {
      id: 'transponder-laser-p3',
      requester: 'tiina-aho',
      text: 'For XC-4 do I power cycle the whole shelf or just the card? I would ask Jaana since she did this before.',
      key: {
        relatedIncidentKeys: ['A', 'B'],
        applicable: 'qualified',
        answers: {
          'helena-ketola': { 'power.scope=card': 'yes' },
          'jaana-peltonen': { 'power.scope=card': 'unknown' },
        },
        noQuestionNeeded: true,
        expectedRecommendation: 'qualified',
        laterOutcome: 'recovered',
      },
    },
  ],
};

export default spec;
