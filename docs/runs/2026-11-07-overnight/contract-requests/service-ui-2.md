# Contract requests from service-ui (phase 2)

1. `ApiRoutes['POST /demo/reset']`: request `{ seed?, defaultPerson? }` (id or name of a directory person) and response `{ ok, imported, defaultPersonEntityId? }`. Implemented in the service as an extension (zod schema accepts `defaultPerson`; response carries `defaultPersonEntityId`); the typed client casts the extra field. Please add both optional fields to the contract.
2. `UserSettings.currentPersonEntityId` is cleared to `''` after a demo reset against an empty directory; consider documenting that an empty string means "nobody chosen".
