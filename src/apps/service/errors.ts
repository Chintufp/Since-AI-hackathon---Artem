/** An error that carries the HTTP status the service answers with (MCP maps it to an error result). */
export class ServiceError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
  }
}

export const notFound = (what: string): ServiceError => new ServiceError(404, what);
export const forbidden = (what: string): ServiceError => new ServiceError(403, what);
export const conflict = (what: string): ServiceError => new ServiceError(409, what);
export const badRequest = (what: string): ServiceError => new ServiceError(400, what);

/** Library errors are plain Errors; map the lifecycle ones the coordinator throws to proper statuses. */
export function toServiceError(e: unknown): ServiceError {
  if (e instanceof ServiceError) return e;
  const message = e instanceof Error ? e.message : String(e);
  if (/^Unknown (question|investigation)/.test(message) || /has no recorded starting principal/.test(message)) return notFound(message);
  if (/not the recipient|^Only the (recipient|requester)|Only the requester or an agent/.test(message)) return forbidden(message);
  if (/only queued\/delivered|Nothing to undo|System cancellations|^Question is /.test(message)) return conflict(message);
  return new ServiceError(500, message);
}
