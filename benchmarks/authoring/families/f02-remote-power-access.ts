import type { FamilySpec } from '../spec.ts';

const spec: FamilySpec = {
  entry: {
    id: 'remote-power-access',
    split: 'demo',
    description: 'Remote radio site resets from unstable DC power; rectifier swap helps briefly, then it recurs and a loose breaker terminal is found. Site access instructions live only in an email.',
    tags: ['access-fact', 'recurrence', 'temporary-recovery', 'no-answer', 'wrong-recipient-trap', 'no-question-needed'],
  },
  people: [
    { slug: 'ilmari-karjalainen', name: 'Ilmari Karjalainen', role: 'Field Engineer', groups: ['field'], slack: 'U201', email: 'ilmari.karjalainen@kalevanet.example' },
    { slug: 'marja-niemi', name: 'Marja Niemi', role: 'NOC Engineer', groups: ['noc'], slack: 'U202', email: 'marja.niemi@kalevanet.example' },
    { slug: 'risto-peltola', name: 'Risto Peltola', role: 'Power Specialist', groups: ['power', 'field'], slack: 'U203', email: 'risto.peltola@kalevanet.example' },
    { slug: 'eino-salo', name: 'Eino Salo', role: 'Site Access Coordinator', groups: ['access'], available: false, slack: 'U204', email: 'eino.salo@kalevanet.example' },
    { slug: 'pirkko-laine', name: 'Pirkko Laine', role: 'Regional Team Lead', groups: ['field'], slack: 'U205', email: 'pirkko.laine@kalevanet.example' },
    { slug: 'kaisa-hautala', name: 'Kaisa Hautala', role: 'Field Engineer', groups: ['field'], slack: 'U206', email: 'kaisa.hautala@kalevanet.example' },
  ],
  teams: [
    { id: 't1', inc: 'A', who: 'marja-niemi', time: '14:02', text: 'Ilmari, RBS-310 keeps dropping off and coming back, roughly every 40 minutes since noon. DC low alarms in between. You are the closest, can you go?' },
    { id: 't2', inc: 'A', who: 'ilmari-karjalainen', time: '14:05', text: "I'm 30 minutes away. Is it the same cabinet type as RBS-301?" },
    { id: 't3', inc: 'A', who: 'marja-niemi', time: '14:06', text: 'Yes, same cabinet type, installed 2016.' },
    { id: 't4', inc: 'A', who: 'ilmari-karjalainen', time: '15:10', text: 'On site. Rectifier module 2 is warm and its fan is loud. DC voltage swings between 46 and 53 volts.' },
    { id: 't5', inc: 'A', who: 'risto-peltola', time: '15:12', text: "Sounds like module 2 is failing. Swap it, there are spares in the depot box. Pirkko was out at that cabinet in the spring, I think, so she may have noted something." },
    { id: 't6', inc: 'A', who: 'ilmari-karjalainen', time: '15:40', text: 'Swapped module 2. Voltage is steady at 53.4 volts now, no resets for 25 minutes.' },
    { id: 't7', inc: 'A', who: 'marja-niemi', time: '15:42', text: 'Confirmed from the NOC side, the site has been stable since 15:38.' },
    { id: 't8', inc: 'A', who: 'risto-peltola', time: '15:45', text: 'Good. Keep the old module for inspection please.' },
    { id: 't9', who: 'ilmari-karjalainen', time: '15:46', text: 'Will do. Did you hear the canteen is switching to the new lunch menu tomorrow?' },
    { id: 't10', who: 'marja-niemi', time: '15:47', text: 'Ha, no. Thanks Ilmari.' },
  ],
  emails: [
    {
      id: 'f02-access-310',
      inc: 'C',
      from: 'eino-salo',
      to: ['ilmari-karjalainen'],
      cc: ['kaisa-hautala'],
      date: 'Wed, 20 Aug 2026 09:12:00 +0300',
      subject: 'RBS-310 site access (barrier and cabinet key)',
      body: `Hi Ilmari,

Access to RBS-310 as agreed:

- Road barrier code: 5802. The landlord changes it every October and I normally get the new code by email around the 5th.
- Cabinet key is in the lockbox on the left gatepost, lockbox code 1946.
- If the barrier is jammed, call the landlord's caretaker. Do not drive around it, there is a reindeer fence on the side track.

I am on leave from 3 November to 1 December. Pirkko does not handle access codes, so please do not ask her.

Eino`,
    },
  ],
  slackChannels: [{ name: 'noc-ops', members: ['marja-niemi', 'ilmari-karjalainen', 'risto-peltola', 'pirkko-laine', 'kaisa-hautala'] }],
  slack: [
    { id: 's1', channel: 'noc-ops', day: '2026-04-02', time: '08:12:00', who: 'marja-niemi', inc: 'B', text: 'RBS-310 is flapping again with the same DC low alarms as the rectifier case last week. Opening a new ticket.' },
    { id: 's2', channel: 'noc-ops', day: '2026-04-02', time: '08:20:00', who: 'risto-peltola', inc: 'B', thread: 's1', text: 'Then module 2 was not the whole story. Ilmari, please check the breaker terminals and the DC bus bars before swapping anything else.' },
    { id: 's3', channel: 'noc-ops', day: '2026-04-02', time: '11:30:00', who: 'ilmari-karjalainen', inc: 'B', thread: 's1', text: 'On site. The DC distribution breaker terminal was loose with burn marks. Tightened it and replaced the lug. Voltage is steady.' },
    { id: 's4', channel: 'noc-ops', day: '2026-04-02', time: '14:00:00', who: 'marja-niemi', inc: 'B', thread: 's1', text: 'No resets since 11:25 on our side.' },
    { id: 's5', channel: 'noc-ops', day: '2026-04-02', time: '14:10:00', who: 'kaisa-hautala', text: 'Reminder that the van service is booked for Friday, please leave keys at the front desk.' },
  ],
  entities: [
    { name: 'RBS-310', type: 'site', attributes: { 'site.id': 'RBS-310', 'unit.installed_year': 2016 } },
    { name: 'RBS-310 rectifier module 2', type: 'component', attributes: {} },
    { name: 'RBS-310 DC distribution breaker', type: 'component', attributes: {} },
  ],
  incidents: [
    {
      key: 'A',
      title: 'RBS-310 resets with DC low alarms; rectifier module swapped',
      realCause: 'Loose DC distribution breaker terminal; the rectifier swap disturbed the terminals and restored contact only temporarily.',
      claims: [
        { type: 'observation', statement: 'RBS-310 drops off and returns about every 40 minutes with DC low alarms', by: 'marja-niemi' },
        { type: 'observation', statement: 'Rectifier module 2 at RBS-310 is warm with a loud fan and DC voltage swings between 46 and 53 volts', by: 'ilmari-karjalainen' },
        { type: 'condition', statement: 'RBS-310 cabinet was installed in 2016', by: 'marja-niemi' },
        { type: 'hypothesis', statement: 'Rectifier module 2 is failing', by: 'risto-peltola' },
        { type: 'advice', statement: 'Swap rectifier module 2 using the spare from the depot box', by: 'risto-peltola' },
        { type: 'action', statement: 'Ilmari swapped rectifier module 2 at RBS-310', by: 'ilmari-karjalainen' },
        { type: 'outcome', statement: 'Voltage steady at 53.4 volts and no resets for 25 minutes after the swap', by: 'ilmari-karjalainen' },
        { type: 'outcome', statement: 'NOC confirms RBS-310 stable since 15:38', by: 'marja-niemi' },
      ],
      attempts: [{ action: 'component.replace.rectifier', by: 'ilmari-karjalainen', performed: true }],
      outcome: { result: 'recovered', lasting: 'recurred', reportedBy: 'ilmari-karjalainen' },
      knowledge: {
        'ilmari-karjalainen': { knows: ['power.state', 'power.breaker_inspected_at_first_visit', 'action.performed'], canObserve: [] },
        'marja-niemi': { knows: ['alarms.state'], canObserve: ['alarms.state', 'traffic.state'] },
        'risto-peltola': { knows: ['reasoning behind the swap advice'], canObserve: [] },
        'pirkko-laine': { knows: [], canObserve: [] },
      },
      accessGroups: ['noc', 'field', 'power'],
    },
    {
      key: 'B',
      title: 'RBS-310 flaps again; loose breaker terminal found',
      realCause: 'Loose DC distribution breaker terminal with burn marks.',
      claims: [
        { type: 'observation', statement: 'RBS-310 flaps again with the same DC low alarms after the rectifier swap', by: 'marja-niemi' },
        { type: 'advice', statement: 'Check breaker terminals and DC bus bars before swapping anything else', by: 'risto-peltola' },
        { type: 'observation', statement: 'DC distribution breaker terminal at RBS-310 was loose with burn marks', by: 'ilmari-karjalainen' },
        { type: 'action', statement: 'Ilmari tightened the breaker terminal and replaced the lug', by: 'ilmari-karjalainen' },
        { type: 'outcome', statement: 'Voltage steady and no resets since 11:25 after the terminal repair', by: 'ilmari-karjalainen' },
      ],
      attempts: [{ action: 'component.replace.lug', by: 'ilmari-karjalainen', performed: true }],
      outcome: { result: 'recovered', lasting: 'unknown', reportedBy: 'ilmari-karjalainen' },
      knowledge: {
        'ilmari-karjalainen': { knows: ['power.state', 'power.breaker_inspected_at_first_visit', 'action.performed'], canObserve: [] },
        'marja-niemi': { knows: ['alarms.state'], canObserve: ['alarms.state', 'traffic.state'] },
        'risto-peltola': { knows: ['reasoning behind the terminal check'], canObserve: [] },
      },
      accessGroups: ['noc', 'field', 'power'],
    },
    {
      key: 'C',
      title: 'RBS-310 site access instructions',
      realCause: 'Not an incident: access facts kept only in an email (barrier code changes every October).',
      claims: [
        { type: 'access-fact', statement: 'RBS-310 road barrier code is 5802 and the landlord changes it every October', by: 'eino-salo' },
        { type: 'access-fact', statement: 'RBS-310 cabinet key is in the lockbox on the left gatepost with lockbox code 1946', by: 'eino-salo' },
        { type: 'access-fact', statement: 'If the RBS-310 barrier is jammed call the landlord caretaker and do not drive around it', by: 'eino-salo' },
      ],
      attempts: [],
      outcome: { result: 'unknown', lasting: 'unknown' },
      knowledge: {
        'eino-salo': { knows: ['site.access', 'site.access_code_current'], canObserve: ['site.access_code_current'] },
        'pirkko-laine': { knows: [], canObserve: [] },
      },
      accessGroups: ['field', 'access'],
    },
  ],
  problems: [
    {
      id: 'remote-power-access-p1',
      requester: 'kaisa-hautala',
      text: 'RBS-310 is dropping off the network again with DC low alarms. The rectifier module was swapped before, so I plan to swap it again. Sensible?',
      observations: [
        { key: 'site.id', value: 'RBS-310', label: 'Site RBS-310' },
        { key: 'power.state', value: 'unstable', label: 'DC power unstable' },
        { key: 'alarms.state', value: 'active', label: 'DC low alarms active' },
      ],
      key: {
        relatedIncidentKeys: ['A', 'B'],
        applicable: 'qualified',
        answers: {},
        noQuestionNeeded: true,
        expectedRecommendation: 'qualified',
        distinguishingConditions: [{ key: 'component.replaced', value: 'rectifier' }],
        laterOutcome: 'recovered',
      },
    },
    {
      id: 'remote-power-access-p2',
      requester: 'kaisa-hautala',
      text: "I'm driving out to RBS-310 tomorrow. What's the barrier code?",
      observations: [{ key: 'site.id', value: 'RBS-310', label: 'Site RBS-310' }],
      key: {
        relatedIncidentKeys: ['C'],
        applicable: 'qualified',
        consequentialGap: { description: 'The code on file is from August and the landlord changes it every October. Has it changed?', answerers: ['eino-salo'], answer: 'yes', unanswerable: true },
        answers: {
          'eino-salo': { 'site.access_code_current=5802': 'no' },
          'pirkko-laine': { 'site.access_code_current=5802': 'unknown' },
        },
        noQuestionNeeded: false,
        expectedRecommendation: 'check-first',
        laterOutcome: 'unknown',
      },
    },
    {
      id: 'remote-power-access-p3',
      requester: 'marja-niemi',
      text: 'Someone said Pirkko checked the RBS-310 cabinet in the spring. Was the breaker ever inspected before the first rectifier swap?',
      key: {
        relatedIncidentKeys: ['A', 'B'],
        applicable: 'qualified',
        consequentialGap: { description: 'Was the breaker inspected at the first visit? Pirkko is mentioned only secondhand and did not do the visit.', answerers: ['ilmari-karjalainen'], answer: 'no' },
        answers: {
          'ilmari-karjalainen': { 'power.breaker_inspected_at_first_visit=true': 'no' },
          'pirkko-laine': { 'power.breaker_inspected_at_first_visit=true': 'unknown' },
          'risto-peltola': { 'power.breaker_inspected_at_first_visit=true': 'unknown' },
        },
        noQuestionNeeded: false,
        expectedRecommendation: 'qualified',
        laterOutcome: 'recovered',
      },
    },
  ],
};

export default spec;
