/**
 * B3: the panel's two new lines as pure functions, so they are tested without a DOM: the provenance strip under a
 * heading (textContent only, hidden when the service sent none) and the Settings row "<first name>'s cost".
 */
import type { ExpertCostView } from '../contracts/service.ts';
import type { ProvenanceView } from '../contracts/views.ts';

/** The strip on any element with textContent, title and hidden (an HTMLElement in the panel). */
export function setProvenance(p: { textContent: string | null; title: string; hidden: boolean }, v: ProvenanceView | undefined): void {
  p.textContent = v?.text ?? '';
  p.title = v?.text ?? '';
  p.hidden = !v;
}

/** The Settings cost row's label, its two lines and its tooltip. */
export function costRow(c: ExpertCostView): { label: string; line: string; store: string; title: string } {
  const secs = `${Math.round(c.seconds.total)} s${c.seconds.clock === 'simulated' ? ' simulated' : ''}`;
  return {
    label: `${c.name.split(' ')[0]}'s cost`,
    line: `asked ${c.asked} · answered ${c.answered} · ${secs} · reused ${c.reuse.total} (${c.reuse.people} people, ${c.reuse.agents} agents)`,
    store: c.storeHealth?.line ?? '',
    title: `${c.line}${c.storeHealth ? `\n${c.storeHealth.line}` : ''}`,
  };
}
