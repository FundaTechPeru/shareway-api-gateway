import type {Request, Response} from 'express';
import {STATUS_CODES} from 'node:http';

/** Answers with the same error body as the monolith and the extracted services. */
export function sendError(
  req: Request,
  res: Response,
  status: number,
  message: string,
): void {
  res.status(status).json({
    timestamp: new Date().toISOString(),
    status,
    error: STATUS_CODES[status] ?? 'Error',
    message,
    path: req.originalUrl.split('?')[0],
    fieldErrors: [],
  });
}
