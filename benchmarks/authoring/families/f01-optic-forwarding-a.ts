import type { FamilySpec } from '../spec.ts';

const spec: FamilySpec = {
  entry: {
    id: 'optic-forwarding-a',
    split: 'demo',
    description: 'Optical module replaced on an older transmission node: link up, traffic counters zero; interface reset restores forwarding. Outcome reported once and retold twice.',
    tags: ['missing-outcome', 'copied-retelling', 'lookalike-different-cause', 'useful-no', 'no-question-needed', 'same-incident-continuation'],
  },
  people: [
    { slug: 'aarne-koskela', name: 'Aarne Koskela', role: 'Field Engineer', groups: ['field'], slack: 'U101', email: 'aarne.koskela@kalevanet.example' },
    { slug: 'helmi-virtanen', name: 'Helmi Virtanen', role: 'Network Expert', groups: ['transport', 'noc'], slack: 'U102', email: 'helmi.virtanen@kalevanet.example' },
    { slug: 'tapio-lehto', name: 'Tapio Lehto', role: 'NOC Engineer', groups: ['noc'], slack: 'U103', email: 'tapio.lehto@kalevanet.example' },
    { slug: 'liisa-makela', name: 'Liisa Mäkelä', role: 'Field Engineer', groups: ['field'], slack: 'U104', email: 'liisa.makela@kalevanet.example' },
    { slug: 'jussi-rantanen', name: 'Jussi Rantanen', role: 'Planning Engineer', groups: ['planning'], slack: 'U105', email: 'jussi.rantanen@kalevanet.example' },
    { slug: 'outi-heino', name: 'Outi Heino', role: 'NOC Team Lead', groups: ['noc'], slack: 'U106', email: 'outi.heino@kalevanet.example' },
  ],
  teams: [
    { id: 't1', inc: 'A', who: 'aarne-koskela', time: '09:14', text: "Morning Helmi, I'm at the TRN-117 site now. Swapped the SFP on the transmission node.\nLink is up and alarms cleared, but the traffic counters are still at zero. Have you seen this before?" },
    { id: 't2', inc: 'A', who: 'helmi-virtanen', time: '09:16', text: 'Morning. How is the optical level on the new module?' },
    { id: 't3', inc: 'A', who: 'aarne-koskela', time: '09:17', text: 'Normal, receive level is in range, same as the old one.' },
    { id: 't4', inc: 'A', who: 'helmi-virtanen', time: '09:19', text: "Then it sounds like the older units. After a module swap they sometimes keep the old forwarding state and don't pass traffic even though everything looks fine. Is this one from the 2019 batch?" },
    { id: 't5', inc: 'A', who: 'aarne-koskela', time: '09:20', text: 'Yes, 2019. Controller card revision A according to the sticker.' },
    { id: 't6', inc: 'A', who: 'helmi-virtanen', time: '09:22', text: "Reset the interface on both ends, shut and no shut, that should rebuild it. Don't do that on the newer controller revisions though, they behave differently." },
    { id: 't7', inc: 'A', who: 'aarne-koskela', time: '09:23', text: 'Ok, doing the reset now, far end first.' },
    { id: 't8', who: 'helmi-virtanen', time: '09:24', text: 'Go for it. Coffee after? Also your depot car park was full again yesterday, I had to leave the van on the street.' },
    { id: 't9', inc: 'A', who: 'aarne-koskela', time: '09:31', text: 'Reset done on both ends. Traffic is passing again, counters are moving.' },
    { id: 't10', inc: 'A', who: 'helmi-virtanen', time: '09:32', text: "Good. I'll put it in the handover note." },
    { id: 't11', who: 'aarne-koskela', time: '09:33', text: 'Thanks, heading to the next site.' },
  ],
  emails: [
    {
      id: 'f01-handover-117',
      inc: 'A',
      copyOf: ['t1', 't9'],
      from: 'helmi-virtanen',
      to: ['tapio-lehto'],
      cc: ['outi-heino'],
      subject: 'Handover: TRN-117 after SFP replacement',
      body: `Hi Tapio,

For the handover: Aarne replaced the SFP at TRN-117. Link was up and alarms cleared, but counters stayed at zero. That is the behaviour we have seen on older units, so an interface reset on both ends was done and traffic is passing again according to Aarne.

Nothing else open on this one as far as I know.

Helmi`,
    },
  ],
  slackChannels: [
    { name: 'noc-handover', members: ['tapio-lehto', 'outi-heino', 'helmi-virtanen', 'aarne-koskela'] },
    { name: 'field-chat', members: ['liisa-makela', 'aarne-koskela', 'jussi-rantanen'] },
  ],
  slack: [
    { id: 's1', channel: 'noc-handover', day: '2026-03-12', time: '10:05:00', who: 'tapio-lehto', inc: 'A', copyOf: 'f01-handover-117', text: "FYI from Helmi's handover: TRN-117 needed an interface reset after the SFP swap, traffic is back per Aarne." },
    { id: 's2', channel: 'noc-handover', day: '2026-03-12', time: '10:07:00', who: 'outi-heino', thread: 's1', text: 'Thanks, noted.' },
    { id: 's3', channel: 'field-chat', day: '2026-03-12', time: '13:40:00', who: 'liisa-makela', text: 'Anyone got a spare 10G SFP+ I can borrow for Thursday?' },
    { id: 's4', channel: 'field-chat', day: '2026-03-12', time: '13:52:00', who: 'jussi-rantanen', thread: 's3', text: 'Check the van stock list first, I think there are two in the grey box.' },
  ],
  entities: [
    { name: 'TRN-117', type: 'asset', attributes: { 'unit.installed_year': 2019, 'unit.revision': 'A', 'site.id': 'S-117' } },
    { name: 'S-117', type: 'site', attributes: {} },
  ],
  incidents: [
    {
      key: 'A',
      title: 'TRN-117 no traffic after SFP replacement',
      realCause: 'Older revision-A transmission unit kept stale forwarding state after the optical module swap; interface reset rebuilt it.',
      claims: [
        { type: 'observation', statement: 'TRN-117 link is up and alarms are cleared after the SFP replacement', by: 'aarne-koskela' },
        { type: 'observation', statement: 'Traffic counters on TRN-117 are still zero after the SFP replacement', by: 'aarne-koskela' },
        { type: 'observation', statement: 'Optical receive level on the new module is normal', by: 'aarne-koskela' },
        { type: 'condition', statement: 'TRN-117 is a 2019 unit with controller card revision A', by: 'aarne-koskela' },
        { type: 'hypothesis', statement: 'Older units keep the old forwarding state after a module swap and do not pass traffic', by: 'helmi-virtanen' },
        { type: 'advice', statement: 'Reset the interface on both ends to rebuild forwarding state on older revision A units', by: 'helmi-virtanen' },
        { type: 'advice', statement: 'Do not apply the interface reset on newer controller revisions', by: 'helmi-virtanen' },
        { type: 'action', statement: 'Aarne reset the interface on both ends of the TRN-117 link', by: 'aarne-koskela' },
        { type: 'outcome', statement: 'Traffic is passing again and counters are moving after the interface reset', by: 'aarne-koskela' },
      ],
      attempts: [
        { action: 'sfp.replace', by: 'aarne-koskela', performed: true },
        { action: 'interface.reset', by: 'aarne-koskela', performed: true },
      ],
      outcome: { result: 'recovered', lasting: 'unknown', reportedBy: 'aarne-koskela' },
      knowledge: {
        'aarne-koskela': { knows: ['unit.revision', 'unit.installed_year', 'action.performed', 'optical.level', 'interface.status', 'traffic.counters'], canObserve: [] },
        'helmi-virtanen': { knows: ['reasoning behind the reset advice', 'revision compatibility rule'], canObserve: ['traffic.state'] },
        'tapio-lehto': { knows: [], canObserve: ['traffic.state', 'traffic.counters', 'alarms.state'] },
        'outi-heino': { knows: [], canObserve: ['traffic.state'] },
        'jussi-rantanen': { knows: ['unit.revision', 'unit.installed_year'], canObserve: ['unit.revision', 'unit.installed_year'] },
      },
      accessGroups: ['noc', 'field', 'transport', 'planning'],
    },
  ],
  problems: [
    {
      id: 'optic-forwarding-a-p1',
      requester: 'liisa-makela',
      text: "I just replaced the SFP at TRN-233. Link is up, alarms cleared, but the counters are still zero. Should I reset the interface like on TRN-117?",
      observations: [
        { key: 'interface.status', value: 'up', label: 'Interface is up' },
        { key: 'alarms.state', value: 'cleared', label: 'Alarms cleared' },
        { key: 'traffic.counters', value: 'zero', label: 'Traffic counters are zero' },
        { key: 'component.replaced', value: 'sfp', label: 'SFP was replaced' },
      ],
      key: {
        relatedIncidentKeys: ['A'],
        applicable: 'inapplicable',
        consequentialGap: { description: 'Is TRN-233 an older revision A unit? The reset advice was limited to older revisions and a newer revision rules it out.', answerers: ['jussi-rantanen'], answer: 'no' },
        answers: { 'jussi-rantanen': { 'unit.revision=A': 'no', 'unit.revision=B': 'yes', 'unit.installed_year=2019': 'no' } },
        noQuestionNeeded: false,
        expectedRecommendation: 'none',
        distinguishingConditions: [{ key: 'unit.revision', value: 'B' }],
        laterOutcome: 'unknown',
      },
    },
    {
      id: 'optic-forwarding-a-p2',
      requester: 'outi-heino',
      text: 'The customer behind TRN-117 asks whether the link has stayed stable since the SFP swap. Can we tell them it is fixed?',
      key: {
        relatedIncidentKeys: ['A'],
        applicable: 'reuse',
        consequentialGap: { description: 'Has TRN-117 traffic stayed up since the reset? Recovery was reported once by one person and never re-checked.', answerers: ['tapio-lehto', 'helmi-virtanen'], answer: 'yes' },
        answers: {
          'tapio-lehto': { 'traffic.state=flowing': 'yes', 'traffic.counters=increasing': 'yes' },
          'helmi-virtanen': { 'traffic.state=flowing': 'yes' },
          'aarne-koskela': { 'traffic.state=flowing': 'unknown' },
        },
        noQuestionNeeded: false,
        expectedRecommendation: 'reuse',
        laterOutcome: 'recovered',
      },
    },
    {
      id: 'optic-forwarding-a-p3',
      requester: 'jussi-rantanen',
      text: 'TRN-089 is a 2018 unit, revision A. I swapped the SFP: link up, alarms cleared, counters zero. Same as what happened on TRN-117?',
      observations: [
        { key: 'interface.status', value: 'up', label: 'Interface is up' },
        { key: 'alarms.state', value: 'cleared', label: 'Alarms cleared' },
        { key: 'traffic.counters', value: 'zero', label: 'Traffic counters are zero' },
        { key: 'component.replaced', value: 'sfp', label: 'SFP was replaced' },
        { key: 'unit.installed_year', value: 2018, label: 'Installed 2018' },
        { key: 'unit.revision', value: 'A', label: 'Controller revision A' },
      ],
      key: {
        relatedIncidentKeys: ['A'],
        applicable: 'qualified',
        answers: {},
        noQuestionNeeded: true,
        expectedRecommendation: 'qualified',
        laterOutcome: 'recovered',
      },
    },
  ],
};

export default spec;
