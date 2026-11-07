/**
 * The one network path of the Slack connectors (read-only pull, DM poller, SlackConnector.fetchHistory): route label
 * `slack-web` in ROUTE_REGISTRY, and a guard that refuses before any request unless the operator opted in with
 * KT_SLACK_LIVE=1 and the URL is on https://slack.com. Injected fetch implementations (tests, the fake workspace) do not
 * go through here. `globalThis.fetch` is looked up per request, so installNetworkGuard still applies on top.
 */
import { NetworkProviderBlockedError, routeInfo } from '../models/routes.ts';

export const SLACK_ROUTE = routeInfo('slack-web');
export const SLACK_ORIGIN = 'https://slack.com';

type Env = Record<string, string | undefined>;

/** A fetch for the Slack clients' defaults. Throws NetworkProviderBlockedError without KT_SLACK_LIVE=1 or off slack.com. */
export function slackNetworkFetch<F>(env: Env = process.env): F {
  return (async (url: string, init?: unknown) => {
    const u = new URL(url);
    if (env.KT_SLACK_LIVE !== '1') throw new NetworkProviderBlockedError(`Slack Web API ${u.pathname} (route ${SLACK_ROUTE.version}) without KT_SLACK_LIVE=1`);
    if (u.origin !== SLACK_ORIGIN) throw new NetworkProviderBlockedError(`${u.origin} on the Slack route (only ${SLACK_ORIGIN})`);
    return (globalThis.fetch as (u: string, i?: unknown) => Promise<unknown>)(url, init);
  }) as unknown as F;
}
