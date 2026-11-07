# Contract requests from the UI/desktop worker

No blocking changes. Notes for the orchestrator/service owner:

1. `Principal.groups` is supplied by the client from configuration (`demoPrincipal` default, `?groups=` override). The service should treat it as a hint and resolve access itself.
2. The desktop shims CORS for the service origin inside Electron (including the OPTIONS preflight), so the service does not need CORS headers for the desktop. A plain browser client would.
3. The UI relies on `ReceiptView.pointsAwarded` being absent when Points & rewards is off (it also hides it itself).
4. `GET /questions` is called with `personEntityId` only; the UI filters `queued | delivered | deferred` locally, so returning all statuses is fine.
