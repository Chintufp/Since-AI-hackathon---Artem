import type { FamilySpec } from '../spec.ts';

const spec: FamilySpec = {
  entry: {
    id: 'cabling-pinch',
    split: 'train',
    description: 'Intermittent CRC errors on a hub uplink. SFP swap does not help; days later the patch cord is found pinched by the cabinet door. The one person who fitted the permanent fix is on leave.',
    tags: ['same-incident-continuation', 'no-answer', 'multi-step'],
  },
  people: [
    { slug: 'kimmo-rautio', name: 'Kimmo Rautio', role: 'Field Engineer', groups: ['field'], slack: 'U601', email: 'kimmo.rautio@kalevanet.example' },
    { slug: 'aila-nurmi', name: 'Aila Nurmi', role: 'NOC Engineer', groups: ['noc'], slack: 'U602', email: 'aila.nurmi@kalevanet.example' },
    { slug: 'henrik-sjoberg', name: 'Henrik Sjöberg', role: 'Transport Expert', groups: ['transport', 'noc'], slack: 'U603', email: 'henrik.sjoberg@kalevanet.example' },
    { slug: 'seppo-lahti', name: 'Seppo Lahti', role: 'Cable Technician', groups: ['field'], available: false, slack: 'U604', email: 'seppo.lahti@kalevanet.example' },
    { slug: 'marketta-ylonen', name: 'Marketta Ylönen', role: 'Planning Engineer', groups: ['planning'], slack: 'U605', email: 'marketta.ylonen@kalevanet.example' },
    { slug: 'reijo-kauppi', name: 'Reijo Kauppi', role: 'Field Engineer', groups: ['field'], slack: 'U606', email: 'reijo.kauppi@kalevanet.example' },
  ],
  teams: [
    { id: 't1', inc: 'A', who: 'aila-nurmi', time: '07:50', text: 'Kimmo, the HUB-07 uplink to the core router shows CRC errors in bursts since about 05:00. The link stays up and most traffic flows, but customers report slowness.' },
    { id: 't2', inc: 'A', who: 'henrik-sjoberg', time: '07:52', text: 'What does the optical level say?' },
    { id: 't3', inc: 'A', who: 'aila-nurmi', time: '07:53', text: 'Receive power is normal on both ends.' },
    { id: 't4', inc: 'A', who: 'henrik-sjoberg', time: '07:55', text: "Then swap the SFP on our side anyway, it's cheap and we have had bad batches. Kimmo, can you do that on your way?" },
    { id: 't5', inc: 'A', who: 'kimmo-rautio', time: '09:05', text: 'At HUB-07. Swapped the SFP, the link is up again.' },
    { id: 't6', inc: 'A', who: 'aila-nurmi', time: '09:20', text: 'CRC errors are still climbing, same burst pattern.' },
    { id: 't7', inc: 'A', who: 'henrik-sjoberg', time: '09:24', text: 'OK so not the SFP. Check the patch cord between the SFP and the ODF, clean both connectors and look for kinks.' },
    { id: 't8', inc: 'A', who: 'kimmo-rautio', time: '09:50', text: "Cleaned both connectors. Errors dropped a lot but not to zero. The patch cord looks fine to me, no kinks I can see. I have to leave for the next job, I'll come back tomorrow with a spare cord." },
    { id: 't9', inc: 'A', who: 'aila-nurmi', time: '09:52', text: 'OK, errors are at a low level for now. I will keep watching.' },
    { id: 't10', who: 'kimmo-rautio', time: '09:53', text: 'Has anyone found a parking permit for the Hakala depot? I have asked three times already.' },
  ],
  emails: [
    {
      id: 'f06-hub07-cause',
      inc: 'A',
      from: 'kimmo-rautio',
      to: ['henrik-sjoberg'],
      cc: ['aila-nurmi'],
      date: 'Tue, 09 Jun 2026 12:20:00 +0300',
      subject: 'HUB-07 CRC errors: cause found',
      body: `Hi Henrik,

Back at HUB-07 this morning. When I closed the cabinet door the patch cord was pinched by the door edge. That only happens with the door fully shut, which is why it looked fine with the door open yesterday. I replaced the patch cord and rerouted it away from the hinge side. Aila sees no CRC errors since 11:00.

Kimmo`,
    },
  ],
  slackChannels: [{ name: 'field-chat', members: ['kimmo-rautio', 'seppo-lahti', 'marketta-ylonen', 'reijo-kauppi', 'aila-nurmi'] }],
  slack: [
    { id: 's1', channel: 'field-chat', day: '2026-06-12', time: '14:00:00', who: 'seppo-lahti', inc: 'A', text: 'HUB-07: I re-dressed the cabinet cabling and fitted a cable guard at the door edge. The same cabinet type is at HUB-09 and HUB-12, I will check them in July.' },
    { id: 's2', channel: 'field-chat', day: '2026-06-12', time: '14:05:00', who: 'kimmo-rautio', thread: 's1', text: 'Thanks Seppo, good to know.' },
    { id: 's3', channel: 'field-chat', day: '2026-06-12', time: '14:10:00', who: 'seppo-lahti', thread: 's1', text: 'I am on leave from tomorrow until 10 August.' },
    { id: 's4', channel: 'field-chat', day: '2026-06-12', time: '15:30:00', who: 'marketta-ylonen', text: 'Does anyone know when the new rain jackets arrive? Mine leaks.' },
  ],
  entities: [
    { name: 'HUB-07', type: 'site', attributes: { 'site.id': 'HUB-07' } },
    { name: 'HUB-07 uplink patch cord', type: 'component', attributes: {} },
    { name: 'HUB-09', type: 'site', attributes: { 'site.id': 'HUB-09' } },
  ],
  incidents: [
    {
      key: 'A',
      title: 'HUB-07 uplink CRC errors; patch cord pinched by the cabinet door',
      realCause: 'Patch cord pinched by the cabinet door edge when the door is fully shut; SFP and connectors were fine.',
      claims: [
        { type: 'observation', statement: 'HUB-07 uplink shows CRC errors in bursts while the link stays up', by: 'aila-nurmi' },
        { type: 'observation', statement: 'Optical receive power is normal on both ends of the HUB-07 uplink', by: 'aila-nurmi' },
        { type: 'advice', statement: 'Swap the SFP on the HUB-07 side', by: 'henrik-sjoberg' },
        { type: 'action', statement: 'Kimmo swapped the SFP at HUB-07', by: 'kimmo-rautio' },
        { type: 'outcome', statement: 'CRC errors keep climbing after the SFP swap', by: 'aila-nurmi' },
        { type: 'advice', statement: 'Check the patch cord between the SFP and the ODF and clean both connectors', by: 'henrik-sjoberg' },
        { type: 'action', statement: 'Kimmo cleaned both connectors and errors dropped but not to zero', by: 'kimmo-rautio' },
        { type: 'hypothesis', statement: 'The patch cord is pinched by the cabinet door only when the door is fully closed', by: 'kimmo-rautio' },
        { type: 'action', statement: 'Kimmo replaced the patch cord and rerouted it away from the hinge side', by: 'kimmo-rautio' },
        { type: 'outcome', statement: 'No CRC errors at HUB-07 since 11:00 after the patch cord replacement', by: 'aila-nurmi' },
        { type: 'action', statement: 'Seppo re-dressed the cabinet cabling and fitted a cable guard at the door edge', by: 'seppo-lahti' },
      ],
      attempts: [
        { action: 'sfp.replace', by: 'kimmo-rautio', performed: true },
        { action: 'optics.check', by: 'kimmo-rautio', performed: true },
        { action: 'cable.replace', by: 'kimmo-rautio', performed: true },
      ],
      outcome: { result: 'recovered', lasting: 'unknown', reportedBy: 'aila-nurmi' },
      knowledge: {
        'kimmo-rautio': { knows: ['component.replaced', 'cable.condition', 'action.performed'], canObserve: [] },
        'aila-nurmi': { knows: ['interface.crc_errors'], canObserve: ['interface.crc_errors', 'optical.level'] },
        'henrik-sjoberg': { knows: ['reasoning behind the SFP and cable advice'], canObserve: ['interface.crc_errors'] },
        'seppo-lahti': { knows: ['cable.guard_fitted', 'cable.condition'], canObserve: ['cable.guard_fitted'] },
        'reijo-kauppi': { knows: [], canObserve: ['component.replaced', 'cable.condition'] },
      },
      accessGroups: ['noc', 'field', 'transport'],
    },
  ],
  problems: [
    {
      id: 'cabling-pinch-p1',
      requester: 'aila-nurmi',
      text: 'HUB-11 uplink has CRC errors in bursts, link stays up. Optical levels are normal. What should Reijo check?',
      observations: [
        { key: 'interface.status', value: 'up', label: 'Link up' },
        { key: 'optical.level', value: 'normal', label: 'Optical levels normal' },
      ],
      key: {
        relatedIncidentKeys: ['A'],
        applicable: 'qualified',
        consequentialGap: { description: 'Was the SFP already replaced at HUB-11? If yes the SFP step is pointless and the cable check is next; the cable condition is then the second thing to ask.', answerers: ['reijo-kauppi'], answer: 'yes' },
        answers: {
          'reijo-kauppi': { 'component.replaced=sfp': 'yes', 'cable.condition=damaged': 'yes' },
          'kimmo-rautio': { 'component.replaced=sfp': 'unknown', 'cable.condition=damaged': 'unknown' },
          'henrik-sjoberg': { 'component.replaced=sfp': 'unknown', 'cable.condition=damaged': 'unknown' },
        },
        noQuestionNeeded: false,
        expectedRecommendation: 'qualified',
        distinguishingConditions: [
          { key: 'component.replaced', value: 'sfp' },
          { key: 'cable.condition', value: 'damaged' },
        ],
        laterOutcome: 'recovered',
      },
    },
    {
      id: 'cabling-pinch-p2',
      requester: 'aila-nurmi',
      text: 'HUB-07 has shown zero CRC errors for 48 hours now, since the new patch cord went in.',
      observations: [{ key: 'interface.crc_errors', value: 'zero', label: 'Zero CRC errors for 48 hours' }],
      key: {
        relatedIncidentKeys: ['A'],
        applicable: 'reuse',
        answers: { 'aila-nurmi': { 'interface.crc_errors=zero': 'yes' } },
        noQuestionNeeded: true,
        expectedRecommendation: 'reuse',
        laterOutcome: 'recovered',
      },
    },
    {
      id: 'cabling-pinch-p3',
      requester: 'kimmo-rautio',
      text: 'HUB-09 is the same cabinet type and now has CRC errors in bursts. At HUB-07 it was the door pinching the cord. Is the guard Seppo fitted the permanent fix I should copy?',
      observations: [{ key: 'site.id', value: 'HUB-09', label: 'Site HUB-09' }],
      key: {
        relatedIncidentKeys: ['A'],
        applicable: 'qualified',
        consequentialGap: { description: 'Was a cable guard actually fitted at HUB-07 and does it hold? Only Seppo fitted it and he is on leave.', answerers: ['seppo-lahti'], answer: 'yes', unanswerable: true },
        answers: {
          'seppo-lahti': { 'cable.guard_fitted=true': 'yes' },
          'kimmo-rautio': { 'cable.guard_fitted=true': 'unknown' },
          'marketta-ylonen': { 'cable.guard_fitted=true': 'unknown' },
        },
        noQuestionNeeded: false,
        expectedRecommendation: 'check-first',
        laterOutcome: 'unknown',
      },
    },
  ],
};

export default spec;
