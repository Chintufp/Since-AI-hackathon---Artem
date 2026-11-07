import type { FamilySpec } from '../spec.ts';

const spec: FamilySpec = {
  entry: {
    id: 'weak-mains-psu',
    split: 'validation',
    description: 'A microwave hop site on weak mains drops in the evenings. A PSU swap helps for three weeks, then the drops return; the real cause is voltage sag and an aged battery string. Winter access instructions exist only in an email.',
    tags: ['temporary-recovery', 'recurrence', 'access-fact', 'no-question-needed'],
  },
  people: [
    { slug: 'tauno-hiltunen', name: 'Tauno Hiltunen', role: 'Field Engineer', groups: ['field'], slack: 'U701', email: 'tauno.hiltunen@kalevanet.example' },
    { slug: 'anneli-koivisto', name: 'Anneli Koivisto', role: 'NOC Engineer', groups: ['noc'], slack: 'U702', email: 'anneli.koivisto@kalevanet.example' },
    { slug: 'olavi-rinne', name: 'Olavi Rinne', role: 'Power Specialist', groups: ['power', 'field'], slack: 'U703', email: 'olavi.rinne@kalevanet.example' },
    { slug: 'maija-sundstrom', name: 'Maija Sundström', role: 'Site Access Coordinator', groups: ['access'], slack: 'U704', email: 'maija.sundstrom@kalevanet.example' },
    { slug: 'esa-pitkanen', name: 'Esa Pitkänen', role: 'Field Engineer', groups: ['field'], slack: 'U705', email: 'esa.pitkanen@kalevanet.example' },
    { slug: 'sofia-lund', name: 'Sofia Lund', role: 'Operations Team Lead', groups: ['noc', 'field'], slack: 'U706', email: 'sofia.lund@kalevanet.example' },
  ],
  teams: [
    { id: 't1', inc: 'A', who: 'anneli-koivisto', time: '18:20', text: "Tauno, the MW-77 radio link went down for about four minutes, twice this evening. No weather alarms, but an 'input voltage low' power alarm at the same moments. Can you check tomorrow morning?" },
    { id: 't2', inc: 'A', who: 'tauno-hiltunen', time: '18:25', text: 'Sure. Is it the long-haul hop or the access hop?' },
    { id: 't3', inc: 'A', who: 'anneli-koivisto', time: '18:26', text: 'Long-haul hop towards the Salmijärvi tower.' },
    { id: 't4', inc: 'A', who: 'tauno-hiltunen', time: '08:40', text: 'On site. The 48 V PSU output has a ripple on the scope, about 3 volts peak to peak. Looks like it is dying.' },
    { id: 't5', inc: 'A', who: 'olavi-rinne', time: '08:43', text: 'Swap the PSU. But the mains at that site is weak, so keep an eye on it.' },
    { id: 't6', inc: 'A', who: 'tauno-hiltunen', time: '09:10', text: 'PSU swapped. Output is clean and the link is up with good margin.' },
    { id: 't7', inc: 'A', who: 'anneli-koivisto', time: '09:15', text: 'The link is stable from our side, no alarms.' },
    { id: 't8', who: 'tauno-hiltunen', time: '09:16', text: 'It is minus 12 here, my fingers are frozen. Going to the petrol station for coffee.' },
    { id: 't9', who: 'olavi-rinne', time: '09:20', text: 'Log the old PSU as faulty please. And do not forget the safety refresher course next week.' },
  ],
  emails: [
    {
      id: 'f07-access-mw77',
      inc: 'C',
      from: 'maija-sundstrom',
      to: ['tauno-hiltunen'],
      cc: ['sofia-lund'],
      date: 'Tue, 03 Feb 2026 10:00:00 +0200',
      subject: 'MW-77 access: forest road gate and winter route',
      body: `Hi Tauno,

Access instructions for MW-77:

- The forest road gate is locked with a padlock. The key is held by the forest owner, Tuomas Heiskanen. Call him at least 24 hours before the visit.
- From 1 December to 30 April the forest road is not ploughed beyond the gate. In that period take the snowmobile from the Lampela cabin. The cabin key is in the lockbox by the door, code 3290.
- Outside winter you can drive up to the site with the van.

Maija`,
    },
  ],
  slackChannels: [{ name: 'noc-ops', members: ['anneli-koivisto', 'olavi-rinne', 'tauno-hiltunen', 'sofia-lund', 'esa-pitkanen'] }],
  slack: [
    { id: 's1', channel: 'noc-ops', day: '2026-05-12', time: '21:10:00', who: 'anneli-koivisto', inc: 'B', text: 'MW-77 was down again for six minutes at 21:05, input voltage low. That is three weeks after the PSU swap.' },
    { id: 's2', channel: 'noc-ops', day: '2026-05-12', time: '21:20:00', who: 'olavi-rinne', inc: 'B', thread: 's1', text: 'So the PSU was not the cause, or not the only one. The mains logger at the site shows sags to 185 V in the evenings when the neighbouring sawmill starts. The 2018 battery string cannot bridge that.' },
    { id: 's3', channel: 'noc-ops', day: '2026-05-13', time: '10:30:00', who: 'tauno-hiltunen', inc: 'B', thread: 's1', text: 'Replaced the battery string and left a note to monitor the mains. Link is fine.' },
    { id: 's4', channel: 'noc-ops', day: '2026-05-13', time: '11:00:00', who: 'sofia-lund', text: 'Annual leave plans are due on Friday, please fill in the sheet.' },
  ],
  entities: [
    { name: 'MW-77', type: 'asset', attributes: { 'unit.installed_year': 2018, 'site.id': 'MW-77' } },
    { name: 'MW-77 48V PSU', type: 'component', attributes: {} },
    { name: 'MW-77 battery string', type: 'component', attributes: { 'unit.installed_year': 2018 } },
  ],
  incidents: [
    {
      key: 'A',
      title: 'MW-77 evening link drops; PSU swapped',
      realCause: 'Weak mains with evening voltage sags and an aged battery string; the PSU was degraded but replacing it only helped for about three weeks.',
      claims: [
        { type: 'observation', statement: 'MW-77 long-haul radio link drops for about four minutes twice in the evening with input voltage low alarms', by: 'anneli-koivisto' },
        { type: 'observation', statement: 'The 48 V PSU at MW-77 shows about 3 volts peak to peak ripple', by: 'tauno-hiltunen' },
        { type: 'advice', statement: 'Swap the PSU and keep an eye on the weak mains at that site', by: 'olavi-rinne' },
        { type: 'action', statement: 'Tauno swapped the 48 V PSU at MW-77', by: 'tauno-hiltunen' },
        { type: 'outcome', statement: 'PSU output is clean and the MW-77 link is stable with no alarms after the swap', by: 'anneli-koivisto' },
      ],
      attempts: [{ action: 'component.replace.psu', by: 'tauno-hiltunen', performed: true }],
      outcome: { result: 'recovered', lasting: 'recurred', reportedBy: 'anneli-koivisto' },
      knowledge: {
        'tauno-hiltunen': { knows: ['power.state', 'action.performed'], canObserve: [] },
        'anneli-koivisto': { knows: ['alarms.state'], canObserve: ['alarms.state', 'traffic.state', 'power.mains_sag'] },
        'olavi-rinne': { knows: ['power.mains_sag', 'reasoning behind the PSU advice'], canObserve: ['power.mains_sag'] },
      },
      accessGroups: ['noc', 'field', 'power'],
    },
    {
      key: 'B',
      title: 'MW-77 drops again; mains sag and old battery string',
      realCause: 'Evening mains sags to 185 V when a nearby sawmill starts; the 2018 battery string cannot bridge them.',
      claims: [
        { type: 'observation', statement: 'MW-77 down again for six minutes with input voltage low three weeks after the PSU swap', by: 'anneli-koivisto' },
        { type: 'hypothesis', statement: 'Mains at MW-77 sags to 185 V in the evenings and the 2018 battery string cannot bridge it', by: 'olavi-rinne' },
        { type: 'action', statement: 'Tauno replaced the battery string at MW-77', by: 'tauno-hiltunen' },
        { type: 'outcome', statement: 'MW-77 link is fine after the battery string replacement', by: 'tauno-hiltunen' },
      ],
      attempts: [{ action: 'component.replace.battery', by: 'tauno-hiltunen', performed: true }],
      outcome: { result: 'recovered', lasting: 'unknown', reportedBy: 'tauno-hiltunen' },
      knowledge: {
        'tauno-hiltunen': { knows: ['power.state', 'action.performed'], canObserve: [] },
        'anneli-koivisto': { knows: ['alarms.state'], canObserve: ['alarms.state', 'power.mains_sag'] },
        'olavi-rinne': { knows: ['power.mains_sag'], canObserve: ['power.mains_sag'] },
      },
      accessGroups: ['noc', 'field', 'power'],
    },
    {
      key: 'C',
      title: 'MW-77 site access instructions',
      realCause: 'Not an incident: access facts kept in an email (gate key held by the forest owner, winter snowmobile route).',
      claims: [
        { type: 'access-fact', statement: 'MW-77 forest road gate key is held by the forest owner who must be called 24 hours before a visit', by: 'maija-sundstrom' },
        { type: 'access-fact', statement: 'From 1 December to 30 April the road beyond the gate is not ploughed and the snowmobile at the Lampela cabin is used with cabin lockbox code 3290', by: 'maija-sundstrom' },
        { type: 'access-fact', statement: 'Outside winter the van can drive to the MW-77 site', by: 'maija-sundstrom' },
      ],
      attempts: [],
      outcome: { result: 'unknown', lasting: 'unknown' },
      knowledge: { 'maija-sundstrom': { knows: ['site.access'], canObserve: ['site.access'] } },
      accessGroups: ['field', 'access'],
    },
  ],
  problems: [
    {
      id: 'weak-mains-psu-p1',
      requester: 'esa-pitkanen',
      text: 'MW-81 drops for a few minutes every evening with input voltage low alarms. The PSU worked on MW-77 so I plan to swap the PSU here too.',
      observations: [
        { key: 'power.state', value: 'unstable', label: 'Power unstable in the evenings' },
        { key: 'alarms.state', value: 'active', label: 'Input voltage low alarms' },
        { key: 'unit.installed_year', value: 2018, label: 'Installed 2018' },
      ],
      key: {
        relatedIncidentKeys: ['A', 'B'],
        applicable: 'qualified',
        consequentialGap: { description: 'Does the mains at MW-81 sag in the evenings? If yes the PSU swap is likely only temporary and the battery/mains path should be checked.', answerers: ['anneli-koivisto'], answer: 'yes' },
        answers: {
          'anneli-koivisto': { 'power.mains_sag=true': 'yes' },
          'olavi-rinne': { 'power.mains_sag=true': 'unknown' },
          'tauno-hiltunen': { 'power.mains_sag=true': 'unknown' },
        },
        noQuestionNeeded: false,
        expectedRecommendation: 'qualified',
        distinguishingConditions: [{ key: 'power.mains_sag', value: true }],
        laterOutcome: 'recovered',
      },
    },
    {
      id: 'weak-mains-psu-p2',
      requester: 'sofia-lund',
      text: 'Esa is going to MW-77 this week and there is still snow everywhere. How does he get through to the site?',
      observations: [{ key: 'site.access', value: 'key', label: 'Gate locked, winter conditions' }],
      key: {
        relatedIncidentKeys: ['C'],
        applicable: 'reuse',
        answers: {},
        noQuestionNeeded: true,
        expectedRecommendation: 'reuse',
        laterOutcome: 'unknown',
      },
    },
    {
      id: 'weak-mains-psu-p3',
      requester: 'esa-pitkanen',
      text: 'MW-77 dropped again last night with input voltage low. We swapped the PSU in the spring and it recovered, so is it just the PSU again?',
      observations: [
        { key: 'power.state', value: 'unstable', label: 'Power unstable' },
        { key: 'site.id', value: 'MW-77', label: 'Site MW-77' },
      ],
      key: {
        relatedIncidentKeys: ['A', 'B'],
        applicable: 'qualified',
        answers: {},
        noQuestionNeeded: true,
        expectedRecommendation: 'qualified',
        distinguishingConditions: [{ key: 'component.replaced', value: 'psu' }],
        laterOutcome: 'recovered',
      },
    },
  ],
};

export default spec;
