import { ZodError } from 'zod';

export function errorHandler(error, req, res, _next) {
  if (error instanceof ZodError) {
    return res.status(422).json({
      error: 'Validation failed',
      details: error.flatten()
    });
  }

  const status = error.status || 500;
  const payload = {
    error: status === 500 ? 'Internal server error' : error.message
  };

  if (error.details) {
    payload.details = error.details;
  }

  if (status === 500) {
    console.error(error);
  }

  return res.status(status).json(payload);
}
