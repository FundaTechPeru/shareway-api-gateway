# shareway-api-gateway

API gateway of **ShareWay**, the university platform for scheduled shared rides with verified
drivers (UPC, SI657 Fundamentos de Arquitectura de Software). It is the single entry point in
front of every service and the piece that made the Strangler Fig migration possible: clients
always called the gateway, and each bounded context moved out of the
[monolith](https://github.com/FundaTechPeru/shareway-monolith) to its own service by changing one
environment variable. Booking & Pricing was the last one to move, so the monolith is no longer
part of the running system.

The gateway has no business logic. It validates the token, limits requests, routes them and
publishes the API documentation of every service.

Node.js 22 · Express 5 · TypeScript (strict) · http-proxy-middleware · jsonwebtoken ·
express-rate-limit · opossum · helmet · pino · swagger-ui-express · vitest and supertest.

## Route table

Defined in [src/routes.ts](src/routes.ts). Every service is `standalone` now: each path prefix
only goes to its own `UPSTREAM_*` variable and answers 503 while it is not set.

| Service | Path prefixes | Upstream variable |
|---|---|---|
| Driver Management | `/api/v1/auth`, `/api/v1/users`, `/api/v1/drivers`, `/api/v1/driver-documents` | `UPSTREAM_DRIVER_MANAGEMENT` |
| Trip Planning & Matching | `/api/v1/trip-requests`, `/api/v1/driver-availabilities` | `UPSTREAM_TRIP_PLANNING_MATCHING` |
| Booking & Pricing | `/api/v1/bookings`, `/api/v1/fares`, `/api/v1/fare-rules` | `UPSTREAM_BOOKING_PRICING` |
| Payments & Settlement | `/api/v1/payments`, `/api/v1/payment-methods`, `/api/v1/settlements`, `/api/v1/admin/settlements` | `UPSTREAM_PAYMENTS_SETTLEMENT` |
| Trip Execution | `/api/v1/trips`, rewritten to `/api/viajes` | `UPSTREAM_TRIP_EXECUTION` |

Its OpenAPI document is always read from `/v3/api-docs` on the service itself (`/openapi/v1.json`
for Trip Execution).

- **Public paths** (no token): `/api/v1/auth/login`, `/api/v1/auth/register`, `/health`, `/docs`,
  `/v3/api-docs/**` and `/swagger-ui/**` (redirected to `/docs`). CORS preflight requests also go
  through without a token; the upstream answers them.
- **Hidden paths**: `/api/v1/internal/**` (service-to-service, internal API key) and `/dev/**`
  (dev profile) answer 404. Paths with dot segments, double slashes or encoded separators
  answer 400.
- Anything else outside the table answers 404.

## Request flow

```text
client ─► helmet ─► X-Request-Id ─► request log ─► path guard ─► JWT ─► rate limit
                                        │                                   │
                                        └─► /health   /docs, /v3/api-docs ◄─┤
                                                                            ▼
                                                                       route table
                                                                            │
                                                                    circuit + timeout
                                                                            │
                                              extracted service · Trip Execution
```

- **Token.** HS256 tokens issued by Driver Management, checked with the same `JWT_SECRET`; the
  token must carry `sub` (user UUID) and `role`. The `Authorization` header is forwarded as is,
  so the upstream validates the token again.
- **X-Request-Id.** Kept when the client sends one, generated otherwise; it is forwarded to the
  upstream, returned in the response and used as the id of the log line.
- **Rate limit.** `RATE_LIMIT_MAX` requests per `RATE_LIMIT_WINDOW_MS`, per user when the request
  carries a token and per IP otherwise. `/health` is never limited.
- **Resilience.** One circuit breaker (opossum) per upstream URL, so each service fails on its
  own. Connection errors and timeouts count as failures; once the circuit opens, the gateway
  answers 503 with `Retry-After` without calling the upstream. An upstream that stays silent for
  `UPSTREAM_TIMEOUT_MS` gets 504, one that cannot be reached 502.
- **Errors.** The gateway answers with the same body as the services:
  `{timestamp, status, error, message, path, fieldErrors}`.

## Strangler Fig: how each service was extracted

Every context left the monolith the same way:

1. Deploy the extracted service with the same `JWT_SECRET`, serving the same paths under
   `/api/v1` and its OpenAPI document at `/v3/api-docs`.
2. Point the gateway to it, for example `UPSTREAM_PAYMENTS_SETTLEMENT=http://payments:8080`, and
   restart the gateway. The startup log lists where each service is served.
3. Clients do not change: the same paths, tokens and Swagger UI now reach the new service.
4. Once the context was removed from the monolith's own code, its route was marked `standalone`
   in `src/routes.ts`, so it never falls back there again.

| Service | Status |
|---|---|
| Driver Management | Extracted and removed from the monolith (`shareway-driver-management-service`) |
| Payments & Settlement | Extracted and removed from the monolith (`shareway-payments-settlement-service`); its `/api/v1/internal/**` endpoints stay private |
| Trip Planning & Matching | Extracted and removed from the monolith (`shareway-trip-planning-matching-service`) |
| Booking & Pricing | Extracted and removed from the monolith (`shareway-booking-pricing`), the last one to move |

## API documentation

Swagger UI at [http://localhost:8000/docs](http://localhost:8000/docs) with one entry per service
in the selector. Each document is fetched from the current upstream of the service and rewritten:
its `servers` point to `PUBLIC_URL`, so **Try it out** goes through the gateway and its token
check, Trip Execution paths are shown as `/api/v1/trips`, and paths the gateway does not route
(such as `/api/v1/internal/**`) are left out. Log in with `POST /api/v1/auth/login` and paste the
`accessToken` in **Authorize**.

## Running locally

Prerequisites: Node.js 22.15 or later (see `.nvmrc`) and, for the full setup, Docker.

### Gateway, extracted services and PostgreSQL with Docker

Clone
[shareway-driver-management-service](https://github.com/FundaTechPeru/shareway-driver-management-service),
[shareway-payments-settlement-service](https://github.com/FundaTechPeru/shareway-payments-settlement-service),
[shareway-trip-planning-matching-service](https://github.com/FundaTechPeru/shareway-trip-planning-matching-service)
and [shareway-booking-pricing](https://github.com/FundaTechPeru/shareway-booking-pricing) next to
this repository (or set `DRIVER_MANAGEMENT_CONTEXT`, `PAYMENTS_SETTLEMENT_CONTEXT`,
`TRIP_PLANNING_MATCHING_CONTEXT` and `BOOKING_PRICING_CONTEXT` to their paths), then:

```bash
cp .env.example .env            # set DB_PASSWORD, JWT_SECRET and INTERNAL_API_KEY
docker compose up --build       # gateway on http://localhost:8000
```

Only the gateway publishes a port; the services are reached through it. Trip Execution runs on its
own: set `UPSTREAM_TRIP_EXECUTION=http://host.docker.internal:<port>` to reach it on the host.

### Gateway only

With Driver Management already running on `http://localhost:8081`, Payments & Settlement on
`http://localhost:8085`, Trip Planning & Matching on `http://localhost:8083` and Booking & Pricing
on `http://localhost:8084`:

```bash
npm install
cp .env.example .env            # set JWT_SECRET to the one shared with the services
npx tsx watch --env-file=.env src/server.ts
# or: npm run build && node --env-file=.env dist/server.js
```

### Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8000` | HTTP port |
| `PUBLIC_URL` | `http://localhost:<PORT>` | URL clients use; the OpenAPI documents point to it |
| `JWT_SECRET` | none, required | HS256 secret shared with every service |
| `UPSTREAM_MONOLITH` | empty | Unused: kept only so a context could move back into the monolith if it ever had to |
| `UPSTREAM_DRIVER_MANAGEMENT`, `UPSTREAM_PAYMENTS_SETTLEMENT`, `UPSTREAM_TRIP_PLANNING_MATCHING`, `UPSTREAM_BOOKING_PRICING` | empty | URL of the service; its paths answer 503 while empty |
| `UPSTREAM_TRIP_EXECUTION` | empty | Trip Execution; `/api/v1/trips` answers 503 while empty |
| `UPSTREAM_TIMEOUT_MS` | `10000` | Time without an answer before 504 (also for the API documents) |
| `CIRCUIT_ERROR_THRESHOLD_PERCENT` | `50` | Failed requests, in a 10 s window, that open a circuit |
| `CIRCUIT_VOLUME_THRESHOLD` | `5` | Requests in the window before the percentage counts |
| `CIRCUIT_RESET_TIMEOUT_MS` | `30000` | Time a circuit stays open before a trial request |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `100` | Quota per client and window |
| `TRUST_PROXY` | `false` | Express `trust proxy` (`true` or number of hops) behind a load balancer |
| `LOG_LEVEL` | `info` | pino level (`silent` turns logs off) |

`docker-compose.yml` also reads `DB_USER`, `DB_PASSWORD`, `INTERNAL_API_KEY`, `ADMIN_EMAIL`,
`ADMIN_PASSWORD`, `GATEWAY_PORT`, `DRIVER_MANAGEMENT_CONTEXT`, `PAYMENTS_SETTLEMENT_CONTEXT`,
`TRIP_PLANNING_MATCHING_CONTEXT` and `BOOKING_PRICING_CONTEXT`.

## Health and logs

`GET /health` answers `{"status":"UP","services":{...}}` with the circuit state of each service
(`CLOSED`, `OPEN`, `HALF_OPEN` or `NOT_CONFIGURED`). It reports the gateway itself, so a failing
upstream never makes the container unhealthy.

Logs are JSON lines (pino), one per request with the request id, method, URL, status, latency and
user id. Tokens and cookies are redacted. Circuit changes and upstream failures are logged too.

## Tests

```bash
npm run check                   # lint (gts), type check and tests
```

The vitest and supertest suites start the app against fake upstreams on random ports and cover the
route table and its overrides, token validation, request ids, hidden and non-normalized paths,
rate limiting, timeouts and circuits, the rewritten OpenAPI documents and the health report.

## Decisions and known issues

- **Trip Execution and Trip Planning & Matching have no authentication of their own**: the gateway
  is the only token check in front of them, so they must not be reachable from outside the private
  network.
- Trip Execution publishes `/openapi/v1.json` only in its Development environment; elsewhere its
  entry in `/docs` answers 502.
- Upstream answers with 5xx do not open a circuit: they come from a live service (Payments &
  Settlement answers 503 when its payment provider fails), and only the upstream knows why.
- API documents are fetched on every request, without cache, so they always match the upstream.
- The Docker image is built by the CI workflow; it was not built on the development machine.

## Contributing

GitFlow: `main`, `develop`, `feature/*` merged into `develop` with `--no-ff`, `release/*` and
SemVer tags. Commits follow [Conventional Commits](https://www.conventionalcommits.org/) in English
(`type(scope): subject`, at most 72 characters). The code follows the Google TypeScript Style
(`gts`: ESLint and Prettier); run `npm run fix` before committing.
