import type { FamilySpec } from '../spec.ts';

const spec: FamilySpec = {
  entry: {
    id: 'rooftop-threshold',
    split: 'test',
    description: 'A rooftop cabinet raises a high temperature alarm that is really a lowered alarm threshold from a firmware config bundle. Fixed remotely and confirmed the next day. Roof access instructions live in an email; the engineer who knows the bundle rollout is on leave.',
    tags: ['same-incident-continuation', 'no-answer', 'access-fact', 'no-question-needed', 'useful-no'],
  },
  people: [
    { slug: 'kalevi-heino', name: 'Kalevi Heino', role: 'NOC Engineer', groups: ['noc'], slack: 'U1001', email: 'kalevi.heino@kalevanet.example' },
    { slug: 'antero-lahtinen', name: 'Antero Lahtinen', role: 'Transport Engineer', groups: ['transport'], available: false, slack: 'U1002', email: 'antero.lahtinen@kalevanet.example' },
    { slug: 'heikki-moilanen', name: 'Heikki Moilanen', role: 'Operations Team Lead', groups: ['noc', 'transport', 'field'], slack: 'U1003', email: 'heikki.moilanen@kalevanet.example' },
    { slug: 'pirjo-salonen', name: 'Pirjo Salonen', role: 'Field Engineer', groups: ['field'], slack: 'U1004', email: 'pirjo.salonen@kalevanet.example' },
    { slug: 'sari-kivela', name: 'Sari Kivelä', role: 'Property Liaison', groups: ['access'], slack: 'U1005', email: 'sari.kivela@kalevanet.example' },
    { slug: 'lea-aalto', name: 'Lea Aalto', role: 'Field Engineer', groups: ['field'], slack: 'U1006', email: 'lea.aalto@kalevanet.example' },
  ],
  teams: [
    { id: 't1', inc: 'A', who: 'kalevi-heino', time: '14:02', text: 'Antero, ROOF-14 has a high temperature alarm. The cabinet reads 41 degrees and it is 29 outside. Should I send someone up on the roof?' },
    { id: 't2', inc: 'A', who: 'antero-lahtinen', time: '14:05', text: '41 is fine for that cabinet, the spec goes up to 55. Which firmware does it run?' },
    { id: 't3', inc: 'A', who: 'kalevi-heino', time: '14:06', text: '5.1.0, upgraded last Tuesday.' },
    { id: 't4', inc: 'A', who: 'antero-lahtinen', time: '14:09', text: 'That explains it. The 5.1.0 config bundle lowered the temperature alarm threshold to 40 degrees. Raise it back to 55 remotely, no visit needed.' },
    { id: 't5', who: 'kalevi-heino', time: '14:10', text: 'Can I do it or will you?' },
    { id: 't6', who: 'antero-lahtinen', time: '14:12', text: 'I will, give me two minutes.' },
    { id: 't7', inc: 'A', who: 'antero-lahtinen', time: '14:15', text: 'Threshold set back to 55 on ROOF-14.' },
    { id: 't8', inc: 'A', who: 'kalevi-heino', time: '14:17', text: 'The alarm has cleared.' },
    { id: 't9', who: 'heikki-moilanen', time: '14:20', text: 'Reminder for everyone, the team meeting is at 15:00 and we will go through the summer rota.' },
  ],
  emails: [
    {
      id: 'f10-roof-access',
      inc: 'C',
      from: 'sari-kivela',
      to: ['pirjo-salonen'],
      cc: ['heikki-moilanen'],
      date: 'Mon, 09 Mar 2026 11:30:00 +0200',
      subject: 'ROOF-14 roof access',
      body: `Hi Pirjo,

How to get onto the roof at ROOF-14:

- The roof lift key is at the janitor's office, open Monday to Friday 8 to 16. Ask for Mr Eskola.
- Book the visit in the property manager portal at least 48 hours ahead, otherwise the janitor will not hand out the key.
- The roof hatch code is 7314.
- Two people must be present on the roof at all times.

Sari`,
    },
  ],
  slackChannels: [{ name: 'noc-ops', members: ['kalevi-heino', 'antero-lahtinen', 'heikki-moilanen', 'pirjo-salonen', 'lea-aalto'] }],
  slack: [
    { id: 's1', channel: 'noc-ops', day: '2026-07-22', time: '09:10:00', who: 'kalevi-heino', inc: 'A', text: 'ROOF-14 update: no alarm overnight. It peaked at 43 degrees at 15:00 yesterday, below the restored 55 threshold.' },
    { id: 's2', channel: 'noc-ops', day: '2026-07-22', time: '09:20:00', who: 'heikki-moilanen', thread: 's1', text: 'Good. We should check the other 5.1.0 sites too.' },
    { id: 's3', channel: 'noc-ops', day: '2026-07-22', time: '10:00:00', who: 'lea-aalto', text: 'Anyone want to swap Friday shifts with me? I have a dentist appointment.' },
  ],
  entities: [
    { name: 'ROOF-14', type: 'asset', attributes: { 'software.version': '5.1.0', 'unit.installed_year': 2020, 'site.id': 'ROOF-14' } },
    { name: 'ROOF-21', type: 'asset', attributes: { 'software.version': '5.0.4', 'unit.installed_year': 2020 } },
    { name: 'ROOF-31', type: 'asset', attributes: { 'unit.installed_year': 2021 } },
  ],
  incidents: [
    {
      key: 'A',
      title: 'ROOF-14 high temperature alarm from lowered threshold in 5.1.0 config bundle',
      realCause: 'The 5.1.0 config bundle lowered the temperature alarm threshold from 55 to 40 degrees; the cabinet was within spec.',
      claims: [
        { type: 'observation', statement: 'ROOF-14 raises a high temperature alarm while the cabinet reads 41 degrees and it is 29 outside', by: 'kalevi-heino' },
        { type: 'condition', statement: 'ROOF-14 runs firmware 5.1.0 upgraded the previous Tuesday', by: 'kalevi-heino' },
        { type: 'hypothesis', statement: 'The 5.1.0 config bundle lowered the temperature alarm threshold to 40 degrees', by: 'antero-lahtinen' },
        { type: 'advice', statement: 'Raise the alarm threshold back to 55 remotely and no roof visit is needed', by: 'antero-lahtinen' },
        { type: 'action', statement: 'Antero set the ROOF-14 temperature threshold back to 55', by: 'antero-lahtinen' },
        { type: 'outcome', statement: 'The ROOF-14 alarm cleared after the threshold was restored', by: 'kalevi-heino' },
        { type: 'outcome', statement: 'No alarm overnight and a peak of 43 degrees below the restored threshold', by: 'kalevi-heino' },
      ],
      attempts: [
        { action: 'config.rollback', by: 'antero-lahtinen', performed: true },
        { action: 'site.visit', by: 'kalevi-heino', performed: false },
      ],
      outcome: { result: 'recovered', lasting: 'confirmed', reportedBy: 'kalevi-heino' },
      knowledge: {
        'kalevi-heino': { knows: ['temperature.state', 'alarms.state'], canObserve: ['temperature.state', 'alarms.state', 'software.version'] },
        'antero-lahtinen': { knows: ['config.changed', 'reasoning behind the threshold advice'], canObserve: ['config.changed', 'software.version'] },
        'heikki-moilanen': { knows: [], canObserve: [] },
      },
      accessGroups: ['noc', 'transport', 'field'],
    },
    {
      key: 'C',
      title: 'ROOF-14 roof access instructions',
      realCause: 'Not an incident: access facts kept in an email (lift key, booking rule, hatch code, two-person rule).',
      claims: [
        { type: 'access-fact', statement: 'ROOF-14 roof lift key is at the janitor office Monday to Friday 8 to 16 and must be booked 48 hours ahead in the property manager portal', by: 'sari-kivela' },
        { type: 'access-fact', statement: 'ROOF-14 roof hatch code is 7314', by: 'sari-kivela' },
        { type: 'access-fact', statement: 'Two people must be on the ROOF-14 roof at all times', by: 'sari-kivela' },
      ],
      attempts: [],
      outcome: { result: 'unknown', lasting: 'unknown' },
      knowledge: { 'sari-kivela': { knows: ['site.access'], canObserve: ['site.access'] } },
      accessGroups: ['field', 'access'],
    },
  ],
  problems: [
    {
      id: 'rooftop-threshold-p1',
      requester: 'lea-aalto',
      text: 'I have to go up to ROOF-14 tomorrow afternoon. How do I get onto the roof?',
      observations: [{ key: 'site.id', value: 'ROOF-14', label: 'Site ROOF-14' }],
      key: {
        relatedIncidentKeys: ['C'],
        applicable: 'reuse',
        answers: { 'sari-kivela': { 'site.access=hatch': 'yes' } },
        noQuestionNeeded: true,
        expectedRecommendation: 'reuse',
        laterOutcome: 'unknown',
      },
    },
    {
      id: 'rooftop-threshold-p2',
      requester: 'heikki-moilanen',
      text: 'ROOF-21 shows a high temperature alarm at 41 degrees. Raise the threshold back to 55 like on ROOF-14?',
      observations: [
        { key: 'temperature.state', value: 'high', label: 'Cabinet reads 41 degrees, high temperature alarm' },
        { key: 'site.id', value: 'ROOF-21', label: 'Site ROOF-21' },
      ],
      key: {
        relatedIncidentKeys: ['A'],
        applicable: 'inapplicable',
        consequentialGap: { description: 'Does ROOF-21 run firmware 5.1.0 with the lowered threshold? The threshold advice only applies after the 5.1.0 config bundle.', answerers: ['kalevi-heino'], answer: 'no' },
        answers: {
          'kalevi-heino': { 'software.version=5.1.0': 'no', 'software.version=5.0.4': 'yes' },
          'antero-lahtinen': { 'software.version=5.1.0': 'no' },
          'pirjo-salonen': { 'software.version=5.1.0': 'unknown' },
        },
        noQuestionNeeded: false,
        expectedRecommendation: 'none',
        distinguishingConditions: [{ key: 'software.version', value: '5.0.4' }],
        laterOutcome: 'unknown',
      },
    },
    {
      id: 'rooftop-threshold-p3',
      requester: 'heikki-moilanen',
      text: 'ROOF-31 shows a high temperature alarm at 41 degrees. Did it also get the 5.1.0 config bundle with the lowered threshold?',
      observations: [
        { key: 'temperature.state', value: 'high', label: 'Cabinet reads 41 degrees, high temperature alarm' },
        { key: 'site.id', value: 'ROOF-31', label: 'Site ROOF-31' },
      ],
      key: {
        relatedIncidentKeys: ['A'],
        applicable: 'qualified',
        consequentialGap: { description: 'Was the 5.1.0 config bundle pushed to ROOF-31? Only Antero knows which sites received it and he is on leave.', answerers: ['antero-lahtinen'], answer: 'yes', unanswerable: true },
        answers: {
          'antero-lahtinen': { 'config.changed=true@ROOF-31': 'yes' },
          'kalevi-heino': { 'config.changed=true@ROOF-31': 'unknown' },
        },
        noQuestionNeeded: false,
        expectedRecommendation: 'check-first',
        laterOutcome: 'unknown',
      },
    },
  ],
};

export default spec;
