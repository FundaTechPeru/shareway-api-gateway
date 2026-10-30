import type {Express} from 'express';
import jwt from 'jsonwebtoken';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type {AddressInfo} from 'node:net';
import {createApp} from '../src/app.js';
import {loadConfig, type GatewayConfig} from '../src/config.js';

export const JWT_SECRET = 'test-secret-with-at-least-32-bytes-long';
export const USER_ID = '7d8a6c1e-2f3b-4c5d-8e9f-0a1b2c3d4e5f';

/** What a fake upstream saw of a request. */
export interface ReceivedRequest {
  method: string;
  url: string;
  authorization?: string;
  requestId?: string;
  forwardedFor?: string;
}

export interface FakeUpstream {
  url: string;
  received: ReceivedRequest[];
  close: () => Promise<void>;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/** Echoes every request as JSON, unless a handler answers it. */
export async function startUpstream(handler?: Handler): Promise<FakeUpstream> {
  const received: ReceivedRequest[] = [];
  const server = createServer((req, res) => {
    const request: ReceivedRequest = {
      method: req.method ?? '',
      url: req.url ?? '',
      authorization: req.headers.authorization,
      requestId: header(req, 'x-request-id'),
      forwardedFor: header(req, 'x-forwarded-for'),
    };
    received.push(request);
    if (handler) {
      handler(req, res);
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(request));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () =>
      new Promise<void>(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A URL where nothing listens. */
export async function deadUpstreamUrl(): Promise<string> {
  const upstream = await startUpstream();
  await upstream.close();
  return upstream.url;
}

export function testConfig(env: NodeJS.ProcessEnv = {}): GatewayConfig {
  return loadConfig({
    JWT_SECRET,
    UPSTREAM_MONOLITH: 'http://127.0.0.1:9',
    PUBLIC_URL: 'https://api.shareway.test',
    LOG_LEVEL: 'silent',
    ...env,
  });
}

export function testApp(env: NodeJS.ProcessEnv = {}): Express {
  return createApp(testConfig(env));
}

/** Signs a token like Driver Management does; an option set to undefined is left out. */
export function token(
  claims: Record<string, unknown> = {role: 'PASSENGER'},
  options: jwt.SignOptions = {},
  secret = JWT_SECRET,
): string {
  const signOptions: jwt.SignOptions = {
    subject: USER_ID,
    algorithm: 'HS256',
    expiresIn: '5m',
    ...options,
  };
  const defined = Object.fromEntries(
    Object.entries(signOptions).filter(([, value]) => value !== undefined),
  );
  return jwt.sign({email: 'ana@upc.edu.pe', ...claims}, secret, defined);
}

export function bearer(value = token()): string {
  return `Bearer ${value}`;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(',') : value;
}
