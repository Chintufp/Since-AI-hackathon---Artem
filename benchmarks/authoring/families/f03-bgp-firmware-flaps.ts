import type { FamilySpec } from '../spec.ts';

const spec: FamilySpec = {
  entry: {
    id: 'bgp-firmware-flaps',
    split: 'train',
    description: 'BGP sessions flap after a firmware upgrade on aggregation routers. One case is a changed hold-timer default fixed by config rollback; a lookalike on another router is a link with CRC errors.',
    tags: ['lookalike-different-cause', 'multi-step', 'recurrence', 'conflicting-conditions'],
  },
  people: [
    { slug: 'lauri-ahonen', name: 'Lauri Ahonen', role: 'Core Network Engineer', groups: ['core'], slack: 'U301', email: 'lauri.ahonen@kalevanet.example' },
    { slug: 'hanna-kallio', name: 'Hanna Kallio', role: 'NOC Engineer', groups: ['noc'], slack: 'U302', email: 'hanna.kallio@kalevanet.example' },
    { slug: 'toivo-aaltonen', name: 'Toivo Aaltonen', role: 'Network Engineer', groups: ['core'], slack: 'U303', email: 'toivo.aaltonen@kalevanet.example' },
    { slug: 'sanna-ojala', name: 'Sanna Ojala', role: 'Core Team Lead', groups: ['core', 'noc'], slack: 'U304', email: 'sanna.ojala@kalevanet.example' },
    { slug: 'aino-hirvonen', name: 'Aino Hirvonen', role: 'NOC Engineer', groups: ['noc'], slack: 'U305', email: 'aino.hirvonen@kalevanet.example' },
    { slug: 'kalle-mustonen', name: 'Kalle Mustonen', role: 'Vendor Liaison', groups: ['core'], slack: 'U306', email: 'kalle.mustonen@kalevanet.example' },
  ],
  teams: [
    { id: 't1', inc: 'A', who: 'hanna-kallio', time: '10:05', text: 'Lauri, AGG-014 has two BGP peers flapping, up for about five minutes and then down again. It started right after the firmware upgrade at 09:40.' },
    { id: 't2', inc: 'A', who: 'lauri-ahonen', time: '10:07', text: 'Which version did it go to?' },
    { id: 't3', inc: 'A', who: 'hanna-kallio', time: '10:08', text: '9.4.2. It was 9.3.7 before.' },
    { id: 't4', inc: 'A', who: 'lauri-ahonen', time: '10:10', text: 'Did the upgrade bundle include a config change as well?' },
    { id: 't5', inc: 'A', who: 'hanna-kallio', time: '10:11', text: 'Yes, the bundle carried new hold timers, 30 seconds instead of the old 90.' },
    { id: 't6', inc: 'A', who: 'lauri-ahonen', time: '10:14', text: 'That is probably it. The peers behind the long-haul link need 90. Roll back the timer part of the config and leave the firmware as it is.' },
    { id: 't7', inc: 'A', who: 'toivo-aaltonen', time: '10:16', text: 'Rolling back the hold timers on AGG-014 now.' },
    { id: 't8', inc: 'A', who: 'toivo-aaltonen', time: '10:19', text: 'Done. Both sessions are up.' },
    { id: 't9', inc: 'A', who: 'hanna-kallio', time: '10:30', text: 'Still up after ten minutes, no flaps and the counters look clean.' },
    { id: 't10', inc: 'A', who: 'lauri-ahonen', time: '10:31', text: 'Good. I will tell the vendor that the default changed.' },
    { id: 't11', who: 'toivo-aaltonen', time: '10:33', text: 'By the way, has anyone seen my phone charger? I think I left it in meeting room 3.' },
  ],
  emails: [
    {
      id: 'f03-agg014-stable',
      inc: 'A',
      from: 'hanna-kallio',
      to: ['lauri-ahonen'],
      cc: ['sanna-ojala'],
      date: 'Thu, 14 May 2026 08:30:00 +0300',
      subject: 'AGG-014 stable after hold timer rollback',
      body: `Hi Lauri,

Three days have passed since the hold timer rollback on AGG-014. I watched the two peers from the NOC side the whole time and there have been no flaps. I think we can close the ticket.

Hanna`,
    },
  ],
  slackChannels: [{ name: 'core-ops', members: ['aino-hirvonen', 'lauri-ahonen', 'toivo-aaltonen', 'hanna-kallio', 'kalle-mustonen', 'sanna-ojala'] }],
  slack: [
    { id: 's1', channel: 'core-ops', day: '2026-06-18', time: '09:10:00', who: 'aino-hirvonen', inc: 'B', text: 'AGG-031 BGP to the east peer is flapping since the 9.4.2 upgrade last night. Same as AGG-014 in May?' },
    { id: 's2', channel: 'core-ops', day: '2026-06-18', time: '09:14:00', who: 'toivo-aaltonen', inc: 'B', thread: 's1', text: 'No config bundle went to AGG-031, only the firmware. The timers are untouched. CRC errors are climbing on the east link though.' },
    { id: 's3', channel: 'core-ops', day: '2026-06-18', time: '09:20:00', who: 'hanna-kallio', inc: 'B', thread: 's1', text: 'Confirmed, CRC errors are high on the east link port, about 2100 in the last hour.' },
    { id: 's4', channel: 'core-ops', day: '2026-06-18', time: '11:45:00', who: 'toivo-aaltonen', inc: 'B', thread: 's1', text: 'Replaced the optic on the east link. The session is steady now.' },
    { id: 's5', channel: 'core-ops', day: '2026-06-18', time: '12:00:00', who: 'kalle-mustonen', text: 'Vendor webinar on the 9.5 release is on Tuesday, the link is in the wiki.' },
  ],
  entities: [
    { name: 'AGG-014', type: 'asset', attributes: { 'unit.model': 'ar-5', 'unit.installed_year': 2021, 'software.version': '9.4.2' } },
    { name: 'AGG-031', type: 'asset', attributes: { 'unit.model': 'ar-5', 'unit.installed_year': 2020, 'software.version': '9.4.2' } },
    { name: 'AGG-044', type: 'asset', attributes: { 'unit.model': 'ar-5', 'unit.installed_year': 2022 } },
  ],
  incidents: [
    {
      key: 'A',
      title: 'AGG-014 BGP flaps after firmware 9.4.2 with changed hold timers',
      realCause: 'The upgrade bundle changed hold timers from 90 to 30 seconds; peers behind the long-haul link need 90.',
      claims: [
        { type: 'observation', statement: 'Two BGP peers on AGG-014 flap, up about five minutes then down, after the firmware upgrade', by: 'hanna-kallio' },
        { type: 'condition', statement: 'AGG-014 upgraded from firmware 9.3.7 to 9.4.2', by: 'hanna-kallio' },
        { type: 'condition', statement: 'The upgrade bundle carried new hold timers of 30 seconds instead of 90', by: 'hanna-kallio' },
        { type: 'advice', statement: 'Roll back the hold timer part of the config and keep the new firmware', by: 'lauri-ahonen' },
        { type: 'action', statement: 'Toivo rolled back the hold timers on AGG-014', by: 'toivo-aaltonen' },
        { type: 'outcome', statement: 'Both BGP sessions are up with no flaps after the hold timer rollback', by: 'hanna-kallio' },
        { type: 'outcome', statement: 'No flaps for three days after the rollback so the ticket can be closed', by: 'hanna-kallio' },
      ],
      attempts: [
        { action: 'config.rollback', by: 'toivo-aaltonen', performed: true },
        { action: 'firmware.downgrade', by: 'toivo-aaltonen', performed: false },
      ],
      outcome: { result: 'recovered', lasting: 'confirmed', reportedBy: 'hanna-kallio' },
      knowledge: {
        'hanna-kallio': { knows: ['software.version', 'config.changed', 'bgp.session'], canObserve: ['bgp.session', 'alarms.state'] },
        'lauri-ahonen': { knows: ['reasoning behind the timer rollback advice'], canObserve: [] },
        'toivo-aaltonen': { knows: ['config.changed', 'action.performed'], canObserve: ['config.changed'] },
      },
      accessGroups: ['core', 'noc'],
    },
    {
      key: 'B',
      title: 'AGG-031 BGP flaps after firmware 9.4.2 caused by CRC errors on the east link',
      realCause: 'Faulty optic on the east link producing CRC errors; firmware and timers were not involved.',
      claims: [
        { type: 'observation', statement: 'AGG-031 BGP session to the east peer flaps after the 9.4.2 upgrade', by: 'aino-hirvonen' },
        { type: 'condition', statement: 'No config bundle was applied to AGG-031 only the firmware', by: 'toivo-aaltonen' },
        { type: 'observation', statement: 'CRC errors are high on the AGG-031 east link port', by: 'hanna-kallio' },
        { type: 'action', statement: 'Toivo replaced the optic on the AGG-031 east link', by: 'toivo-aaltonen' },
        { type: 'outcome', statement: 'The AGG-031 east session is steady after the optic replacement', by: 'toivo-aaltonen' },
      ],
      attempts: [{ action: 'sfp.replace', by: 'toivo-aaltonen', performed: true }],
      outcome: { result: 'recovered', lasting: 'unknown', reportedBy: 'toivo-aaltonen' },
      knowledge: {
        'toivo-aaltonen': { knows: ['config.changed', 'interface.crc_errors', 'action.performed'], canObserve: ['config.changed', 'interface.crc_errors'] },
        'hanna-kallio': { knows: ['interface.crc_errors', 'bgp.session'], canObserve: ['interface.crc_errors', 'bgp.session'] },
        'aino-hirvonen': { knows: [], canObserve: ['bgp.session'] },
      },
      accessGroups: ['core', 'noc'],
    },
  ],
  problems: [
    {
      id: 'bgp-firmware-flaps-p1',
      requester: 'aino-hirvonen',
      text: 'BGP sessions on AGG-044 started flapping after the 9.4.2 upgrade yesterday. Should we roll back the config like on AGG-014?',
      observations: [
        { key: 'bgp.session', value: 'flapping', label: 'BGP sessions flapping' },
        { key: 'software.version', value: '9.4.2', label: 'Firmware 9.4.2' },
      ],
      key: {
        relatedIncidentKeys: ['A', 'B'],
        applicable: 'qualified',
        consequentialGap: { description: 'Was a config bundle (new timers) applied to AGG-044? If not, the rollback does not apply and the CRC-error lookalike becomes the next thing to check.', answerers: ['toivo-aaltonen', 'hanna-kallio'], answer: 'no' },
        answers: {
          'toivo-aaltonen': { 'config.changed=true': 'no' },
          'hanna-kallio': { 'config.changed=true': 'unknown', 'interface.crc_errors=high': 'yes' },
          'lauri-ahonen': { 'config.changed=true': 'unknown', 'interface.crc_errors=high': 'unknown' },
        },
        noQuestionNeeded: false,
        expectedRecommendation: 'qualified',
        distinguishingConditions: [
          { key: 'config.changed', value: false },
          { key: 'interface.crc_errors', value: 'high' },
        ],
        laterOutcome: 'recovered',
      },
    },
    {
      id: 'bgp-firmware-flaps-p2',
      requester: 'hanna-kallio',
      text: 'AGG-014 is flapping again 25 minutes after the weekend firmware and config bundle. Two peers, up about five minutes each time.',
      observations: [
        { key: 'bgp.session', value: 'flapping', label: 'BGP sessions flapping' },
        { key: 'software.version', value: '9.4.2', label: 'Firmware 9.4.2' },
        { key: 'config.changed', value: true, label: 'Config bundle applied with the upgrade' },
        { key: 'time.since_change', value: 25, label: '25 minutes since the change' },
      ],
      key: {
        relatedIncidentKeys: ['A'],
        applicable: 'reuse',
        answers: {},
        noQuestionNeeded: true,
        expectedRecommendation: 'reuse',
        laterOutcome: 'recovered',
      },
    },
    {
      id: 'bgp-firmware-flaps-p3',
      requester: 'sanna-ojala',
      text: 'Can I tell the customer on AGG-031 that the flapping is fixed after the optic was replaced?',
      key: {
        relatedIncidentKeys: ['B'],
        applicable: 'qualified',
        consequentialGap: { description: 'Is the AGG-031 east session up now? Recovery was reported once, on the day of the repair.', answerers: ['hanna-kallio'], answer: 'yes' },
        answers: {
          'hanna-kallio': { 'bgp.session=up': 'yes' },
          'aino-hirvonen': { 'bgp.session=up': 'yes' },
          'toivo-aaltonen': { 'bgp.session=up': 'unknown' },
        },
        noQuestionNeeded: false,
        expectedRecommendation: 'qualified',
        laterOutcome: 'recovered',
      },
    },
  ],
};

export default spec;
