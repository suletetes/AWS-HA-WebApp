# CloudPulse Application

TypeScript/Express application that serves the infrastructure health dashboard. Built with clean architecture, dependency injection, and the Result pattern for error handling.

## Quick Start

```bash
npm install
npm run build
```

To run locally:

```bash
cp .env.example .env
# Edit .env and set ASG_NAME (required)

npm run dev
```

Open http://localhost:3000. The health endpoint returns 200 immediately. The dashboard shows error indicators for AWS API calls since you are not running on EC2, which is expected.

## Scripts

| Command | What it does |
|---------|-------------|
| `npm run build` | Compiles TypeScript to `dist/` |
| `npm run dev` | Runs with ts-node (no build needed) |
| `npm start` | Runs the compiled output from `dist/` |
| `npm test` | Runs all tests |
| `npm run test:unit` | Unit tests only |
| `npm run test:property` | Property-based tests (fast-check, 100 iterations each) |
| `npm run test:integration` | Integration tests (supertest) |

## Architecture

The application follows a layered structure:

```
src/
  index.ts          Entry point, creates Express app
  config.ts         Environment variable loading with validation
  container.ts      Dependency injection wiring

  types/            Result pattern, health/metrics/instance types
  services/         Business logic (health, metrics, instance, metadata)
  middleware/       Request logging, metrics collection, error handling
  routes/           HTTP endpoints (health, API, dashboard)
  utils/            Logger with rotation, retry with backoff
  views/            EJS template for the dashboard
```

Requests flow through: Middleware -> Routes -> Services -> AWS SDK Clients.

Services depend on interfaces, not implementations. The DI container wires everything together. Tests inject mocks through the same container.

## Endpoints

| Path | Method | Purpose |
|------|--------|---------|
| `/health` | GET | ALB health check. Returns 200 or 503. |
| `/` | GET | Dashboard HTML page. Auto-refreshes every 30s. |
| `/api/status` | GET | Current instance ID, uptime, CPU usage. |
| `/api/instances` | GET | All ASG instances with health status and capacity. |

## Error Handling

The application uses a Result pattern (discriminated unions) instead of thrown exceptions for expected failures. Services return `Result<T, AppError>` where:

- `{ kind: 'success', value: T }` on success
- `{ kind: 'failure', error: AppError }` on failure

Routes pattern-match on the result and return appropriate HTTP responses. The global error handler catches truly unexpected exceptions and returns 500 with a correlation ID for debugging.

## Environment Variables

See `.env.example` for the full list. Only `ASG_NAME` is required. Everything else has sensible defaults.

## Testing

Tests are organized by type:

- `tests/unit/` covers individual services and middleware with mocked dependencies
- `tests/property/` uses fast-check to verify correctness properties hold across random inputs
- `tests/integration/` uses supertest to verify full HTTP request/response cycles

All AWS SDK interactions are behind interfaces. Tests inject mock implementations through the DI container. No aws-sdk-mock library needed.
