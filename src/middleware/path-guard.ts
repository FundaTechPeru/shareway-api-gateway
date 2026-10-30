import type {RequestHandler} from 'express';
import {posix} from 'node:path';
import {sendError} from '../http-errors.js';
import {matchesPrefix} from '../routes.js';

/**
 * Prefixes that stay inside the private network: the service-to-service endpoints, which take the
 * internal API key instead of a token, and the helpers of the dev profile.
 */
export const BLOCKED_PREFIXES = ['/api/v1/internal', '/dev'];

/**
 * Answers 404 for the blocked prefixes, as if they did not exist, and 400 for paths with dot
 * segments, repeated slashes or encoded separators, so a path cannot dodge the route table.
 */
export function guardPaths(): RequestHandler {
  return (req, res, next) => {
    const path = decodePath(req.path);
    if (path === undefined || posix.normalize(path) !== path) {
      sendError(req, res, 400, 'The request path is not normalized');
      return;
    }
    if (matchesPrefix(path.toLowerCase(), BLOCKED_PREFIXES)) {
      sendError(req, res, 404, 'Resource not found');
      return;
    }
    next();
  };
}

function decodePath(path: string): string | undefined {
  try {
    const decoded = decodeURIComponent(path);
    return decoded.includes('\\') ? undefined : decoded;
  } catch {
    return undefined;
  }
}
