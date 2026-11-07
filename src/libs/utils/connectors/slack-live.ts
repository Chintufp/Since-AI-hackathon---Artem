import type { ConnectionCard, ConnectionStatus, ConnectorCapabilities, EvidenceEnvelope } from '../contracts/index.ts';
import { mapSlackMessage, usersById, type SlackChannel, type SlackMessage, type SlackUser } from './slack-map.ts';
import type { AdapterOptions } from './types.ts';
import { slackNetworkFetch } from './slack-net.ts';

export interface SlackConnectorConfig extends Partial<AdapterOptions> {
  /** Explicit opt-in. An environment variable alone never authorizes a live connection. */
  liveAuthorized?: boolean;
  token?: string;
  workspaceId?: string;
}

export interface SlackHistoryPayload { ok?: boolean; messages?: SlackMessage[]; has_more?: boolean; response_metadata?: { next_cursor?: string } }

export const SLACK_CAPABILITIES: ConnectorCapabilities = {
  historicalImport: true, incrementalChanges: true, sourceLookup: true, threadContext: true,
  attachments: true, deletions: false, accessUpdates: false,
};

type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ json(): Promise<unknown> }>;

/**
 * Slack connector. Mapping is pure and fixture-tested; the network path exists but is unreachable
 * unless the caller passes {liveAuthorized: true, token}. It has never been run against a real
 * workspace, so the status never claims 'live-verified'.
 */
export class SlackConnector {
  readonly capabilities = SLACK_CAPABILITIES;
  private readonly config: SlackConnectorConfig;
  constructor(config: SlackConnectorConfig = {}) {
    this.config = { ...config };
  }

  get authorized(): boolean {
    return this.config.liveAuthorized === true && typeof this.config.token === 'string' && this.config.token.length > 0;
  }

  get status(): ConnectionStatus {
    return this.authorized ? 'fixture-tested' : 'awaiting-authorization';
  }

  card(): ConnectionCard {
    return {
      id: `slack:${this.config.workspaceId ?? 'workspace'}`,
      provider: 'slack',
      label: 'Slack',
      status: this.status,
      capabilities: this.capabilities,
      note: this.authorized
        ? 'Authorized by explicit configuration; mapping verified on fixtures only, no live call has been verified.'
        : 'Awaiting authorization: mapping is fixture-tested; no live call is made without explicit {liveAuthorized, token}. Sandbox poller (DM questions, answers by reaction) tested on a fake workspace only: pnpm demo:slack-poll.',
    };
  }

  private ctx(channel: SlackChannel, users: SlackUser[]) {
    return {
      orgId: this.config.orgId ?? 'org',
      connectionId: this.config.connectionId ?? `slack:${this.config.workspaceId ?? 'workspace'}`,
      batchId: this.config.batchId, ingestedAt: this.config.ingestedAt, accessGroups: this.config.accessGroups,
      workspaceId: this.config.workspaceId, channel, users: usersById(users),
    };
  }

  /** conversations.history payload -> envelopes. */
  mapHistory(payload: SlackHistoryPayload, channel: SlackChannel, users: SlackUser[] = []): EvidenceEnvelope[] {
    const c = this.ctx(channel, users);
    return (payload.messages ?? []).map((m) => mapSlackMessage(m, c)).filter((e): e is EvidenceEnvelope => !!e);
  }

  /** conversations.replies payload (first message is the thread parent) -> envelopes, oldest first. */
  mapReplies(payload: SlackHistoryPayload, channel: SlackChannel, users: SlackUser[] = []): EvidenceEnvelope[] {
    const msgs = [...(payload.messages ?? [])].sort((a, b) => Number(a.ts) - Number(b.ts));
    const parentTs = msgs[0]?.ts;
    const c = this.ctx(channel, users);
    return msgs
      .map((m) => mapSlackMessage(m.thread_ts || !parentTs ? m : { ...m, thread_ts: parentTs }, c))
      .filter((e): e is EvidenceEnvelope => !!e);
  }

  /** Live fetch of channel history. Refuses unless explicitly authorized. */
  async fetchHistory(channel: SlackChannel, users: SlackUser[] = [], fetchImpl: FetchLike = slackNetworkFetch<FetchLike>()): Promise<EvidenceEnvelope[]> {
    if (!this.authorized) throw new Error('Slack connector is awaiting authorization: pass {liveAuthorized: true, token} explicitly.');
    const res = await fetchImpl(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(channel.id)}`, {
      headers: { Authorization: `Bearer ${this.config.token}` },
    });
    return this.mapHistory((await res.json()) as SlackHistoryPayload, channel, users);
  }
}
