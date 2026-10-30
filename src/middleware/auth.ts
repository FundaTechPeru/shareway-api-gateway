import type {RequestHandler} from 'express';
import jwt from 'jsonwebtoken';
import {sendError} from '../http-errors.js';

/** User described by a valid access token. */
export interface AuthenticatedUser {
  id: string;
  email?: string;
  role: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      user?: AuthenticatedUser;
    }
  }
}

const PUBLIC_PATHS = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/health',
  '/docs',
  '/swagger-ui.html',
]);
const PUBLIC_PREFIXES = ['/docs/', '/v3/api-docs', '/swagger-ui/'];

/** Paths that answer without a token: login, registration, health and documentation. */
export function isPublicPath(path: string): boolean {
  return (
    PUBLIC_PATHS.has(path) ||
    PUBLIC_PREFIXES.some(prefix => path.startsWith(prefix))
  );
}

/**
 * Validates the HS256 access token issued by Driver Management with the same JWT_SECRET. The
 * Authorization header is left untouched so the upstream service validates it again.
 */
export function authenticate(secret: string): RequestHandler {
  return (req, res, next) => {
    if (isPublicPath(req.path)) {
      next();
      return;
    }
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      sendError(
        req,
        res,
        401,
        'Authentication is required to access this resource',
      );
      return;
    }
    try {
      const claims = jwt.verify(header.slice('Bearer '.length).trim(), secret, {
        algorithms: ['HS256'],
      });
      if (
        typeof claims === 'string' ||
        !claims.sub ||
        typeof claims.role !== 'string'
      ) {
        throw new Error('The token misses the subject or the role');
      }
      res.locals.user = {
        id: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : undefined,
        role: claims.role,
      };
      next();
    } catch {
      sendError(req, res, 401, 'Invalid or expired token');
    }
  };
}
