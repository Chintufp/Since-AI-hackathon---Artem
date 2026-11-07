import type { ConnectionCard, ConnectorCapabilities } from '../contracts/index.ts';
import { SlackConnector } from './slack-live.ts';

export { parseTeamsJson, TEAMS_CONNECTION_ID } from './teams-json.ts';
export type { TeamsExport } from './teams-json.ts';
export { parseEmailText, parseEmailHeaders, EMAIL_CONNECTION_ID } from './email-text.ts';
export { parseSlackExport, readSlackExportDir, SLACK_EXPORT_CONNECTION_ID } from './slack-export.ts';
export type { SlackExportData } from './slack-export.ts';
export { SlackConnector, SLACK_CAPABILITIES } from './slack-live.ts';
export type { SlackConnectorConfig, SlackHistoryPayload } from './slack-live.ts';
export { mapSlackMessage, cleanSlackText } from './slack-map.ts';
export { checkLiveGuard, pullChannelReadOnly, slackWebClient, SlackApiError, WorkspaceMismatchError, SLACK_READ_METHODS, SLACK_READ_SCOPES } from './slack-live-pull.ts';
export type { SlackReadClient, SlackReadMethod, LiveGuardInput, LiveGuardResult, PullOptions, PullResult } from './slack-live-pull.ts';
export type { SlackChannel, SlackMessage, SlackUser } from './slack-map.ts';
export { createSlackPoller, dmText, fileTracking, memoryTracking, pollerGuard, reactionValue, slackDmClient, DM_FOOTER, SLACK_DM_METHODS, SLACK_POLLER_SCOPES } from './slack-poller.ts';
export type { DmRecord, PollReport, ReactionValue, ServiceLike, SlackDmClient, SlackDmMethod, SlackPersonMapping, SlackPoller, SlackPollerConfig, TrackingStore } from './slack-poller.ts';
export { createFakeSlack } from './slack-fake.ts';
export type { FakeDm, FakeSlack, FakeSlackOptions } from './slack-fake.ts';
export { parsePaste, PASTE_CONNECTION_ID } from './paste.ts';
export { detectPasteKind, parsePastedThread } from './paste-thread.ts';
export type { PasteKind } from './paste-thread.ts';
export type { PastePayload } from './paste.ts';
export { parseTimeRef, timeFromEpochSeconds, compareTime, describeTime } from './time.ts';
export { splitEmailBody, normalizeSubject, isReplySubject } from './quoted.ts';
export type { QuotedSegment } from './quoted.ts';
export { makeEnvelope, normName, resolveAccess } from './types.ts';
export type { AdapterOptions, EnvelopeInput, MembershipGrant } from './types.ts';

const importOnly: ConnectorCapabilities = {
  historicalImport: true, incrementalChanges: false, sourceLookup: false, threadContext: true,
  attachments: false, deletions: false, accessUpdates: false,
};
const none: ConnectorCapabilities = { ...importOnly, historicalImport: false, threadContext: false };

/** Cards for the connection list. Status is honest: only mapping on fixtures is verified. */
export function connectionCards(slack: SlackConnector = new SlackConnector()): ConnectionCard[] {
  return [
    slack.card(),
    { id: 'import:teams:file', provider: 'teams', label: 'Teams (file import)', status: 'import-only', capabilities: importOnly, note: 'Exported JSON only; no live Teams access.' },
    { id: 'import:email:file', provider: 'email', label: 'Email (text import)', status: 'import-only', capabilities: importOnly, note: 'Plain-text messages only; no mailbox access.' },
    { id: 'microsoft365', provider: 'microsoft365', label: 'Microsoft 365', status: 'planned', capabilities: none },
    { id: 'github', provider: 'github', label: 'GitHub', status: 'planned', capabilities: none },
    { id: 'jira', provider: 'jira', label: 'Jira', status: 'planned', capabilities: none },
    { id: 'confluence', provider: 'confluence', label: 'Confluence', status: 'planned', capabilities: none },
  ];
}
