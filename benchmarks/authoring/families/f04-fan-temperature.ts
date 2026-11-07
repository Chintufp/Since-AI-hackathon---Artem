import type { FamilySpec } from '../spec.ts';

const spec: FamilySpec = {
  entry: {
    id: 'fan-temperature',
    split: 'train',
    description: 'High inlet temperature in an outdoor cabinet: a clogged dust filter fixes it briefly, then it returns and a stalling fan tray is found. Two NOC staff report the second alarm separately. Later guidance qualifies the earlier advice.',
    tags: ['temporary-recovery', 'duplicate-report', 'conflicting-conditions', 'no-question-needed'],
  },
  people: [
    { slug: 'vesa-hakala', name: 'Vesa Hakala', role: 'Field Engineer', groups: ['field'], slack: 'U401', email: 'vesa.hakala@kalevanet.example' },
    { slug: 'leena-kuusisto', name: 'Leena Kuusisto', role: 'NOC Engineer', groups: ['noc'], slack: 'U402', email: 'leena.kuusisto@kalevanet.example' },
    { slug: 'raisa-turunen', name: 'Raisa Turunen', role: 'Hardware Specialist', groups: ['field', 'transport'], slack: 'U403', email: 'raisa.turunen@kalevanet.example' },
    { slug: 'onni-jokinen', name: 'Onni Jokinen', role: 'NOC Engineer', groups: ['noc'], slack: 'U404', email: 'onni.jokinen@kalevanet.example' },
    { slug: 'kaarina-sirola', name: 'Kaarina Sirola', role: 'Operations Manager', groups: ['noc', 'field'], slack: 'U405', email: 'kaarina.sirola@kalevanet.example' },
  ],
  teams: [
    { id: 't1', inc: 'A', who: 'leena-kuusisto', time: '08:40', text: 'Vesa, OLT-210 at the Hakkila hub is throwing high temperature alarms, inlet 61 degrees. The cabinet is outdoors, 2015 build. Can you take a look?' },
    { id: 't2', inc: 'A', who: 'vesa-hakala', time: '08:44', text: 'On my way, about 20 minutes.' },
    { id: 't3', inc: 'A', who: 'raisa-turunen', time: '08:50', text: "Check the dust filter on the door first. That cabinet type clogs with pollen in spring and then the fans can't pull enough air." },
    { id: 't4', inc: 'A', who: 'vesa-hakala', time: '09:15', text: 'At the cabinet. The filter is nearly solid with pollen. Fans are spinning normally.' },
    { id: 't5', inc: 'A', who: 'raisa-turunen', time: '09:16', text: 'Swap it for a clean one, spare filters are in the van.' },
    { id: 't6', inc: 'A', who: 'vesa-hakala', time: '09:30', text: 'Swapped for a clean filter. Temperature is dropping, 54 now.' },
    { id: 't7', inc: 'A', who: 'leena-kuusisto', time: '09:45', text: 'I see 47 degrees on the NOC side. Alarm cleared.' },
    { id: 't8', who: 'vesa-hakala', time: '09:47', text: 'Great. Lunch? I am starving.' },
    { id: 't9', who: 'raisa-turunen', time: '09:50', text: 'Also, someone remind me to book the training room for Thursday.' },
    { id: 't10', inc: 'A', who: 'vesa-hakala', time: '09:55', text: 'Closing the visit. Filter swapped, alarm cleared.' },
  ],
  emails: [
    {
      id: 'f04-temp-guidance',
      inc: 'B',
      from: 'raisa-turunen',
      to: ['vesa-hakala', 'leena-kuusisto', 'onni-jokinen'],
      cc: ['kaarina-sirola'],
      date: 'Mon, 25 May 2026 10:15:00 +0300',
      subject: 'Cabinet temperature guidance after OLT-210',
      body: `Hi all,

Summary after OLT-210. In spring, high inlet temperature on the 2015-build outdoor cabinets is usually a clogged dust filter, and replacing the filter brings the temperature down. If the alarm comes back within a few days the filter was not the whole cause: check whether fan tray 2 stalls when warm.

The tray replacement only applies to cabinets with the FT-2 fan tray (2015 and 2016 builds). Newer cabinets use FT-3 and should be escalated to me instead of swapping parts.

Raisa`,
    },
  ],
  slackChannels: [{ name: 'noc-ops', members: ['onni-jokinen', 'leena-kuusisto', 'raisa-turunen', 'vesa-hakala', 'kaarina-sirola'] }],
  slack: [
    { id: 's1', channel: 'noc-ops', day: '2026-05-22', time: '06:10:00', who: 'onni-jokinen', inc: 'B', text: 'High temperature alarm on OLT-210 again, inlet 58.' },
    { id: 's2', channel: 'noc-ops', day: '2026-05-22', time: '06:13:00', who: 'leena-kuusisto', inc: 'B', text: 'I see it too, OLT-210 temperature alarm. Ticket raised.' },
    { id: 's3', channel: 'noc-ops', day: '2026-05-22', time: '07:00:00', who: 'raisa-turunen', inc: 'B', thread: 's1', text: 'The filter was swapped on Tuesday so that is not it. Vesa, check fan tray 2, I suspect it stalls when warm.' },
    { id: 's4', channel: 'noc-ops', day: '2026-05-22', time: '09:20:00', who: 'vesa-hakala', inc: 'B', thread: 's1', text: 'Fan tray 2 is stalling intermittently, confirmed. Replaced the tray. Inlet is down to 44.' },
    { id: 's5', channel: 'noc-ops', day: '2026-05-22', time: '12:30:00', who: 'vesa-hakala', inc: 'B', thread: 's1', text: 'Still good at lunchtime, 43.' },
    { id: 's6', channel: 'noc-ops', day: '2026-05-22', time: '13:00:00', who: 'kaarina-sirola', text: 'The midsummer rota is up in the shared folder, please add your wishes by Friday.' },
  ],
  entities: [
    { name: 'OLT-210', type: 'asset', attributes: { 'unit.installed_year': 2015, 'unit.model': 'FT-2', 'site.id': 'Hakkila hub' } },
    { name: 'OLT-210 fan tray 2', type: 'component', attributes: {} },
    { name: 'OLT-210 dust filter', type: 'component', attributes: {} },
  ],
  incidents: [
    {
      key: 'A',
      title: 'OLT-210 high temperature, clogged dust filter replaced',
      realCause: 'Intermittently stalling fan tray 2; the clogged filter was a contributing factor, so replacing it only helped for a few days.',
      claims: [
        { type: 'observation', statement: 'OLT-210 raises high temperature alarms with inlet at 61 degrees', by: 'leena-kuusisto' },
        { type: 'condition', statement: 'OLT-210 is an outdoor cabinet of 2015 build', by: 'leena-kuusisto' },
        { type: 'advice', statement: 'Check and replace the dust filter first because the cabinet type clogs with pollen in spring', by: 'raisa-turunen' },
        { type: 'observation', statement: 'The dust filter is nearly solid with pollen and the fans are spinning', by: 'vesa-hakala' },
        { type: 'action', statement: 'Vesa swapped the dust filter for a clean one', by: 'vesa-hakala' },
        { type: 'outcome', statement: 'Temperature fell to 47 degrees and the alarm cleared after the filter swap', by: 'leena-kuusisto' },
      ],
      attempts: [{ action: 'component.replace.filter', by: 'vesa-hakala', performed: true }],
      outcome: { result: 'recovered', lasting: 'recurred', reportedBy: 'vesa-hakala' },
      knowledge: {
        'vesa-hakala': { knows: ['temperature.state', 'action.performed'], canObserve: [] },
        'leena-kuusisto': { knows: ['temperature.state'], canObserve: ['temperature.state', 'alarms.state'] },
        'raisa-turunen': { knows: ['reasoning behind the filter advice', 'unit.model'], canObserve: [] },
      },
      accessGroups: ['noc', 'field', 'transport'],
    },
    {
      key: 'B',
      title: 'OLT-210 high temperature returns; fan tray 2 replaced',
      realCause: 'Intermittently stalling fan tray 2 (FT-2) in the 2015-build cabinet.',
      claims: [
        { type: 'observation', statement: 'OLT-210 raises a high temperature alarm again with inlet at 58 degrees', by: 'onni-jokinen' },
        { type: 'hypothesis', statement: 'Fan tray 2 stalls when warm and the filter was not the cause', by: 'raisa-turunen' },
        { type: 'observation', statement: 'Fan tray 2 on OLT-210 stalls intermittently', by: 'vesa-hakala' },
        { type: 'action', statement: 'Vesa replaced fan tray 2 on OLT-210', by: 'vesa-hakala' },
        { type: 'outcome', statement: 'Inlet fell to 44 degrees and was still 43 at lunchtime after the tray replacement', by: 'vesa-hakala' },
        { type: 'advice', statement: 'Replace the fan tray only on FT-2 cabinets from 2015 and 2016 builds and escalate newer FT-3 cabinets', by: 'raisa-turunen' },
      ],
      attempts: [{ action: 'component.replace.fan', by: 'vesa-hakala', performed: true }],
      outcome: { result: 'recovered', lasting: 'unknown', reportedBy: 'vesa-hakala' },
      knowledge: {
        'vesa-hakala': { knows: ['temperature.state', 'action.performed'], canObserve: [] },
        'onni-jokinen': { knows: ['temperature.state'], canObserve: ['temperature.state', 'alarms.state'] },
        'leena-kuusisto': { knows: ['temperature.state'], canObserve: ['temperature.state', 'alarms.state'] },
        'raisa-turunen': { knows: ['unit.model', 'reasoning behind the tray advice'], canObserve: [] },
      },
      accessGroups: ['noc', 'field', 'transport'],
    },
  ],
  problems: [
    {
      id: 'fan-temperature-p1',
      requester: 'onni-jokinen',
      text: 'OLT-215 outdoor cabinet, 2016 build, FT-2 fan tray, inlet 60 degrees and a high temperature alarm. It is pollen season. Clean the filter?',
      observations: [
        { key: 'temperature.state', value: 'high', label: 'Inlet 60 degrees, high temperature alarm' },
        { key: 'unit.installed_year', value: 2016, label: 'Installed 2016' },
        { key: 'unit.model', value: 'FT-2', label: 'FT-2 fan tray' },
      ],
      key: {
        relatedIncidentKeys: ['A', 'B'],
        applicable: 'qualified',
        answers: {},
        noQuestionNeeded: true,
        expectedRecommendation: 'qualified',
        laterOutcome: 'temporary',
      },
    },
    {
      id: 'fan-temperature-p2',
      requester: 'leena-kuusisto',
      text: 'OLT-250 outdoor cabinet, 2018 build with the FT-3 fan tray, high temperature alarm at 59 degrees. Same as OLT-210 I guess, swap the fan tray?',
      observations: [
        { key: 'temperature.state', value: 'high', label: 'Inlet 59 degrees, high temperature alarm' },
        { key: 'unit.installed_year', value: 2018, label: 'Installed 2018' },
        { key: 'unit.model', value: 'FT-3', label: 'FT-3 fan tray' },
      ],
      key: {
        relatedIncidentKeys: ['A', 'B'],
        applicable: 'inapplicable',
        answers: {},
        noQuestionNeeded: true,
        expectedRecommendation: 'none',
        distinguishingConditions: [{ key: 'unit.model', value: 'FT-3' }],
        laterOutcome: 'unknown',
      },
    },
    {
      id: 'fan-temperature-p3',
      requester: 'kaarina-sirola',
      text: 'OLT-210 temperature has looked fine since the filter was changed. Can I close the ticket as solved by the filter swap?',
      key: {
        relatedIncidentKeys: ['A', 'B'],
        applicable: 'none',
        answers: {},
        noQuestionNeeded: true,
        expectedRecommendation: 'retain-uncertainty',
        laterOutcome: 'unknown',
      },
    },
  ],
};

export default spec;
