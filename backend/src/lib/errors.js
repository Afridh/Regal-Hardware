export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Wrap an async route handler so rejections reach the error middleware. */
export const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function errorHandler(err, _req, res, _next) {
  // postgres unique violation
  if (err.code === '23505') return res.status(409).json({ error: 'Duplicate value: ' + (err.detail || err.constraint) });
  if (err.code === '23503') return res.status(409).json({ error: 'Record is referenced by other data and cannot be deleted' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Server error', details: err.details });
}
