import { ZodError } from 'zod';

export function errorHandler(error, req, res, _next) {
  if (error instanceof ZodError) {
    const fieldErrors = {};

    for (const issue of error.issues) {
      const path = [...issue.path];
      if (['body', 'params', 'query'].includes(path[0])) {
        path.shift();
      }

      const key = path.join('.');
      if (!key) continue;
      fieldErrors[key] = fieldErrors[key] || [];
      fieldErrors[key].push(issue.message);
    }

    return res.status(422).json({
      error: 'Validation failed',
      details: {
        ...error.flatten(),
        fieldErrors
      }
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
