export class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function notFound(message = 'Resource not found') {
  return new AppError(404, message);
}

export function forbidden(message = 'Access denied') {
  return new AppError(403, message);
}

export function badRequest(message = 'Invalid request', details) {
  return new AppError(400, message, details);
}
