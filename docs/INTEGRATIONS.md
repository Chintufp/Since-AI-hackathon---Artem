# Connections, generalization and reusable modules

**Technical discussion · 6 November 2026 · Design only**

## Established direction and open choices

Artem requires generalization across platforms and organizations to guide the architecture. Reusable elements belong in `libs/utils`, following the separation inspected in the Turku hackathon project. Broad source coverage remains the product direction; the hackathon scope below is now agreed. These are architectural decisions, not claims that connectors have been implemented.

**Closed — hackathon connector strategy, 6 November 2026:** use a custom Slack connector for the live source, Teams/email file imports for historical material, defer Nango, and label other platform connections **Planned**. Git/repository hosts remain on that roadmap. This decision is recorded in [D01](ENGINEERING_DECISIONS.md#d01--source-contract-and-first-adapters).

Slack collection scope and authentication details, import contracts, the module list, package manager and backend language remain open. The current discussion has returned to T01 (automatic evidence/human questions), then T02 (recommendation thresholds). Source contracts will be discussed later; demo selection/presentation belongs to a separate session. This note does not authorize implementation or account connections.

## One Connections screen, several authorization boundaries

Proposed flow: **Choose provider → authorize with provider → select sources and history range → preview scope → import history → synchronize changes.**

An organization connection should be reusable by permitted members, so engineers need not each reconnect the same shared source. Organization policy and the provider's access model determine when an administrator is needed. Personal contributions can remain a separate route. A company-wide import credential must not make all imported material visible to every member.

Microsoft Graph exposes Teams, Outlook/Exchange, SharePoint and OneDrive through one API ecosystem. A Microsoft 365 card could therefore group these services, while requesting the permissions each selected service needs. That grouped UI is our proposal; one successful login does not grant all data access. [Graph overview](https://learn.microsoft.com/en-us/graph/overview), [permissions overview](https://learn.microsoft.com/en-us/graph/permissions-overview).

Independent providers such as Slack and GitHub still need their own grants or installation. We can unify the setup experience and reuse connection infrastructure. GitHub Apps, for example, allow an installation to be granted access to selected repositories. [GitHub installation documentation](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party).

Connection cards should expose source scope, actual capabilities, initial-import progress, last successful sync, failures, reconnect, pause and disconnect. Distinguish live sync, file import, preview and planned support. Stopping a connection and deleting retained memory are separate operations whose behavior must be explicit.

## How to expand coverage

| Route | What we build or reuse | Tradeoff |
| --- | --- | --- |
| Direct provider adapter | Provider authentication, API calls, context mapping and change handling | Most control; recurring integration maintenance |
| Embedded integration framework | Reuse connection UI/authentication and sync infrastructure; implement or adapt mappings | Faster infrastructure reuse; coverage, deployment and data handling need evaluation |
| Generic ingestion API or file import | Accept a documented evidence format from company systems, exports or their existing automation | Extends reach without a native connector for every tool; the sender must supply provenance and updates |

These routes can coexist behind the same evidence contract. **Nango adoption is deferred for the hackathon.** It may be revisited for broader live coverage. Its free self-hosted edition supplies Auth and Proxy; syncs, prebuilt integrations and webhooks require Cloud or Enterprise. It would still require our evidence mapping and verification of source coverage. [Nango self-hosting feature matrix](https://nango.dev/docs/guides/platform/self-hosting/self-hosting).

The intended product claim is: **connect existing work tools and extend to custom sources through a common ingestion contract.** Advertise tested capabilities per connector. An arbitrary URL or API does not automatically supply usable history, identities or access rules.

## Source families and Git

| Family | Candidate sources | Context to preserve |
| --- | --- | --- |
| Conversations | Teams, Slack, email | Authors, replies, recipients, timestamps, edits and attachments |
| Repositories | Local/remote Git; GitHub, GitLab or Bitbucket adapters | Files, paths, revisions, branches/tags, commit messages; hosting discussions through provider adapters |
| Tickets | Jira, ServiceNow, issue trackers | Incident IDs, comments, attempts, ownership and reported outcomes |
| Documents | SharePoint, Drive, Confluence, local files | Sections, versions, citations and access scope |
| Direct contributions | Paste, screenshots, notes, optional transcripts | Contributor, available original context and explicitly missing metadata |

A generic Git reader can cover repository files and available commit history. Hosting features such as pull-request reviews are separate resources; GitHub provides review comments through its API and change events through webhooks. [Review-comment API](https://docs.github.com/en/rest/pulls/comments), [GitHub webhooks](https://docs.github.com/en/webhooks/about-webhooks).

For example, a synthetic review comment may explain that a workaround applies only to version 2.3. Preserve the repository, review, file/commit references and stated version condition. A merge is evidence of a code change, not proof that the change is deployed or that an operational problem is resolved. Repository ingestion reads content; it does not need to execute the project.

## Common contract, explicit differences

Proposed path: **source adapter → common evidence records → context assembly → claims/cases → shared investigation service.**

Every adapter declares what it can actually provide: historical import, incremental changes, source lookup, thread/section context, attachments, deletions and access updates. Missing capability is explicit. Imported snapshots should not be described as continuously synchronized.

The common record carries organization/connection identity, stable source identity, item type, original content/reference, source revision, author, event and ingestion times, context relationships, attachments, access scope and source-specific metadata. Unknowns stay unknown. Namespace identifiers by provider and organization; matching display names do not establish that people or entities are the same.

Keep credentials and sync checkpoints separate from evidence. Use stable source IDs and revisions to make retries safe. Source edits/deletions or access changes must trigger the appropriate re-evaluation of dependent claims and retrieval output. Source copies should retain lineage without being counted as independent observations. Full contracts remain D01/D09/D14 work.

Generalization also requires organization-configured entity aliases, terminology, conditions and policies. Core knowledge types should represent entities, observations, actions, outcomes and conditions without embedding TRN-042 or telecom-specific rules in the connector. Source-specific context handling remains necessary: email quotations, Slack threads and repository revisions have different meanings.

## Reuse the Turku repository boundary

The inspected Turku project places reusable modules in `libs/utils/*`, with apps, benchmarks, experiments and scripts consuming them. Its ingestion module maps several input formats into one internal representation, which is directly relevant here. Adopt that boundary; its technology versions and domain-specific modules are not automatically choices for this project.

**Established rule:** reusable logic and reusable UI elements belong in focused modules under `libs/utils`. Apps compose modules and provide their entry points, transport wiring and presentation. Shared modules never import from apps, scripts, experiments, benchmarks or deployment code. Apps do not import one another; module dependencies remain acyclic.

Proposed layout, to create only when implementation begins:

```text
apps/
  desktop/                    Electron composition and desktop entry points
  service/                    API/MCP and synchronization process wiring
libs/utils/
  contracts/                  Shared evidence, connection and service contracts
  connectors/                 Provider adapters and connection lifecycle
  ingest/                     Validation, normalization and source deduplication
  context/                    Thread, document and revision context assembly
  memory/                     Claims, cases, evidence relationships and revisions
  investigation/              Retrieval, applicability and recommendation policy
  questions/                  Question eligibility, coordination and feedback
  ui/                         Reusable interface elements and presentation helpers
benchmarks/                   Repeatable measurements using shared modules
experiments/                  Recorded comparisons and research runs
data/                         Synthetic/approved fixtures and separate answer keys
scripts/                      Development, fixture and evaluation entry points
deploy/                       Infrastructure and deployment configuration
docs/                         Design, decisions and handoffs
```

This layout does not require separate microservices or immediate packages for every proposed module. Add modules when their responsibility is concrete. Give each a small public interface, a README and appropriate checks; inject configuration rather than hard-coding credentials, providers, model names or company rules. Browser/UI-safe modules must not expose service-side credentials. The same investigation behavior should serve the desktop, API/MCP and evaluation harness.

## Deferred collection details

Source selection, history bounds, thread/attachment handling, edit/delete behavior and the common evidence record remain to be settled in technical contract discussions. Demo-channel and presentation choices belong to another session. The active next question is tracked in [the technical discussion guide](TECHNICAL_DISCUSSIONS.md). Do not reopen the custom-Slack-versus-Nango decision unless its stated reason to revisit applies.
