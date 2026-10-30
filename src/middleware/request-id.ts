import type {RequestHandler} from 'express';
import {randomUUID} from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Gives every request an X-Request-Id, keeping the one sent by the client. The header travels to
 * the upstream with the rest of the request and comes back in the response, so a call can be
 * followed through the gateway and the services.
 */
export function assignRequestId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const id =
      typeof incoming === 'string' && incoming.trim() !== ''
        ? incoming.trim()
        : randomUUID();
    req.headers[REQUEST_ID_HEADER] = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
}
