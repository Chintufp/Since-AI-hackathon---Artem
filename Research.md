# Since AI Hackathon: Challenge Research

Research notes for the four shortlisted challenges: Elisa, Traficom, Turku Energia and FORCIT. These notes distinguish the published summaries from ideas and interpretations. The full briefs, datasets and judging criteria may change the assessment. FORCIT's detailed brief requires an NDA.

## Elisa — operational knowledge for autonomous networks

**Challenge:** Capture network engineers' knowledge from everyday discussions and make it useful for more autonomous operations. Elisa and Google Cloud have announced work on [AI-driven autonomous networks](https://www.googlecloudpresscorner.com/2025-06-17-Elisa-Oyj-and-Google-Cloud-Expand-Collaboration-to-Deliver-AI-Driven-Autonomous-Networks), including specialized agents.

### Market and research

- [Rootly](https://rootly.com/ai-sre) and [incident.io](https://incident.io/post-mortems) use past incidents and conversations to support operational work. [Juniper Marvis](https://www.juniper.net/us/en/products/cloud-services/marvis-ai-assistant.html) offers a network troubleshooting assistant.
- [Nissist](https://arxiv.org/abs/2402.17531) extracts troubleshooting knowledge from guides and historical discussions. A chatbot that simply reads engineers' messages is therefore not new.
- A [Microsoft study](https://arxiv.org/abs/2403.04123) found that simply adding incident discussions did not significantly improve performance in its tested setup; tool-using agents improved factual accuracy. More chat history alone is not necessarily better.

### Project concept: OpsMemory

Extract proposed knowledge cards from incident conversations: symptoms, confirmed cause, failed attempts, fix, equipment and software version, and links to original evidence. An engineer approves each card. When a new incident appears, the system checks whether the advice applies to the current version and either presents the evidence or says it lacks enough information.

**Demo:** An engineer initially suggests the wrong fix, then finds the real cause. Later, a similar incident occurs on different firmware. The system notices the mismatch and asks for another diagnostic instead of confidently repeating outdated advice.

**Evaluation:** Compare against basic chat retrieval on a small test set, measuring source support, correct abstentions and outdated recommendations. The potential differentiator is explaining why a suggestion is trusted and when it no longer applies.

## Traficom — satellite and terrestrial spectrum interference

**Challenge:** Identify interference risks where satellite and terrestrial radio systems share spectrum. Direction of interference, antenna angles, power, location and timing matter; an orbit map alone cannot establish whether interference is harmful.

### Market and research

- Finland's [Fairspectrum](https://www.fairspectrum.com/services/simulations-for-satellite-spectrum-sharing) simulates satellite/mobile sharing and assesses interference, coverage and spectrum use.
- [Transfinite](https://transfinite.com/content/professional) offers established satellite and terrestrial interference modelling.
- The open-source [SHARC simulator](https://github.com/SIMULATOR-WG/SHARC) supports sharing studies. Check its working branch and licence before use.
- Research on [interference nulling](https://arxiv.org/abs/2311.12965) and [power-control/nulling trade-offs](https://arxiv.org/abs/2603.22615) explores protecting satellite systems while preserving terrestrial service. Results depend on the simulated scenario.

### Project concept: Spectrum Risk Desk

Pick one frequency band and one interference direction. Show when and where a proposed scenario may exceed a chosen threshold, the assumptions driving that result, and what changes under two or three hypothetical mitigations. Use a physics model as the baseline; AI could accelerate repeated simulations or identify the most important missing input. State when there is insufficient evidence.

**Evaluation:** Compare against a simulator on held-out scenarios, measuring missed risk events, false alarms, uncertainty and speed. This would be decision support, not a replacement for a formal regulatory study. The full brief's band and data will matter enormously.

## Turku Energia — forecasting under uncertainty

**Challenge:** Improve short-term forecasts as electricity demand and production change. The summary does not establish whether the specific target is price, consumption, generation or something else; that distinction changes the modelling problem.

### Market and research

- [milloin.energy](https://www.milloin.energy/electricity-spot-price-forecast) offers Nordic price forecasts and quotes a Turku Energia operations manager praising its forecast as a comparison alongside others. This suggests another forecast chart alone may not stand out, but does not prove what Turku currently uses.
- Britain's [NESO and Open Climate Fix](https://www.neso.energy/news/solar-nowcasting-innovation-project-improves-solar-forecasting) reported better short-horizon solar forecasts in an evaluation and integrated the system into operations.
- [DeepMind's wind-energy work](https://deepmind.google/blog/machine-learning-can-boost-the-value-of-wind-energy/) connects forecasts to a commercial decision about how much energy to commit. Its reported value gain was relative to making no time-based commitments, not a universal gain over other forecasts.
- [Adaptive conformal prediction for time series](https://proceedings.mlr.press/v162/zaffran22a.html) explores updating prediction intervals as conditions change; it does not guarantee perfect coverage in every changing market.

### Project concept: Forecast Reliability Desk

Take an existing forecast and show when it has historically been reliable, where uncertainty is widening, and which upcoming periods deserve attention. Add a simulated decision comparing a plan based on one predicted value with a plan tested across several plausible outcomes.

[Fingrid public data](https://data.fingrid.fi/en/datasets/245) and weather data could support a fallback demo. Avoid look-ahead leakage: use only weather forecasts and other inputs actually available at the simulated decision time. Evaluate both forecast quality and simulated decision cost. Historical forecasts paired with outcomes would be especially useful.

## FORCIT — drill-and-blast intelligence

**Challenge:** “Drill and Blast Cycle Intelligence,” aimed at safer and smarter industrial decisions. The detailed brief requires an NDA. These notes concern the wider industry and do not claim to describe the confidential task.

### Market and research

- FORCIT's [ForDEX](https://forcitexplosives.com/fordex/) connects digital products, field data and analysis. [O-PitAnalytics](https://www.o-pitblast.com/products/analytics) already consolidates operational information and KPIs.
- [Orica BlastIQ](https://www.orica.com/en/digital-solutions/blast-design-and-execution/blastiq), [Maptek BlastLogic](https://www.maptek.com/products/blastlogic/) and [Strayos](https://www.strayos.com/drilling-and-blasting.html) cover combinations of planning, field data, monitoring and analytics. Generic dashboards and fragmentation analysis are established products.
- A [drilling-data study](https://arxiv.org/abs/2403.10404) used data from 500,000 drillholes across 15 tunnels for rock-mass classification. It supports testing strong tabular models before assuming deep learning is better; results should not be assumed to transfer to FORCIT's data.
- Research on [cleaning drilling data](https://arxiv.org/abs/2506.14289) illustrates how substantial bad or unusual measurements can be as a problem, though it concerns an adjacent drilling domain.

### Project concept: data-trust and review assistant

Using approved historical records, flag inconsistent units, missing IDs, timestamp mismatches and missing evidence, then let a human inspect the source and suggested correction. Alternatively, assemble a reviewable environmental report linking each claim to its measurement. These are hypotheses: FORCIT's existing tools may already address them, so ask what remains manual before building. Keep a prototype retrospective and human-reviewed rather than automatically recommending operational settings.

## Provisional ranking

1. **Elisa:** Strong fit for interpretable AI and a compelling demo. The area is crowded, so focus on evidence, versioning and safe abstention.
2. **Traficom:** Unusual and research-heavy; attractive for a team interested in maths, simulation and radio physics. Domain learning and the actual brief are significant uncertainties.
3. **Turku Energia:** Practical data-science and business case, potentially straightforward to evaluate if suitable historical data is supplied.
4. **FORCIT:** Potentially high impact, with a listed €3,000 first prize, but difficult to judge before the confidential briefing. Confirm current prize terms with organizers.

This ranking is an interpretation, not the organizers' scoring criteria. Before choosing, ask each company about its dataset, the decision it cares about, the current baseline and how it will measure success.

Challenge summaries: [Elisa](https://sinceai.app/events/since-ai-hackathon-2026/elisa) · [Traficom](https://sinceai.app/events/since-ai-hackathon-2026/traficom) · [Turku Energia](https://sinceai.app/events/since-ai-hackathon-2026/turku-energia) · [FORCIT](https://sinceai.app/events/since-ai-hackathon-2026/forcit-group).
