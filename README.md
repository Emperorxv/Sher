# Sher

Collaborative event photography. Groups join a Room, capture photos together, share a live gallery — and unlock it after the event ends.

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 20+ |
| pnpm | 9+ |
| Docker + Docker Compose | any recent |
| Expo CLI | installed via pnpm (workspace dep) |

---

## Local setup

### 1. Clone and install

```bash
git clone https://github.com/emperorxv/sher.git
cd sher
pnpm install
```

### 2. Configure environment

Copy the example env files for each app and fill in any values you need:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/mobile/.env.example apps/mobile/.env
```

For local dev the defaults already point to the Docker services below — you only need to add real provider keys (Paystack, Termii, etc.) when testing those flows. Set `OTP_MOCK=true` in `apps/api/.env` to skip real SMS during development.

### 3. Start infrastructure

```bash
docker compose up -d
```

This starts:
- **Postgres 16** on `localhost:5432` (db: `sher_dev`, user: `sher`)
- **Redis 7** on `localhost:6379`
- **MinIO** (R2 emulator) on `localhost:9000` (console at `localhost:9001`)

Wait for all services to report healthy:

```bash
docker compose ps
```

### 4. Run migrations (Phase 1+)

```bash
pnpm --filter api migrate
```

### 5. Start the dev servers

```bash
pnpm dev
```

Turborepo starts all workspaces in parallel:
- API: `http://localhost:3000` — try `GET /v1/health`
- Worker: runs as a standalone NestJS context
- Mobile: Expo Metro bundler — follow the QR / press `i` for iOS simulator, `a` for Android

---

## Common commands

```bash
pnpm install              # install all workspace deps
pnpm dev                  # start all dev servers
pnpm test                 # run all tests
pnpm lint                 # lint all workspaces
pnpm typecheck            # typecheck all workspaces
pnpm format               # format all files with Prettier
docker compose up -d      # start Postgres + Redis + MinIO
docker compose down       # stop and remove containers (data volumes persist)
docker compose down -v    # also remove volumes (full reset)
```

Filter to a single workspace:

```bash
pnpm --filter api test
pnpm --filter mobile lint
pnpm --filter worker typecheck
```

---

## Project structure

```
sher/
├── apps/
│   ├── api/          NestJS REST + WebSocket API
│   ├── worker/       NestJS BullMQ consumer (background jobs)
│   └── mobile/       Expo React Native app (iOS + Android)
├── packages/
│   ├── config/       Shared ESLint, Prettier, TypeScript presets
│   ├── shared-types/ Zod schemas + shared TS types (used by api + mobile)
│   ├── api-client/   Typed HTTP client for mobile
│   └── ui/           Shared React Native components
├── infra/
│   ├── terraform/    Infrastructure-as-code
│   └── docker/       Supplementary Dockerfiles
├── .github/
│   └── workflows/    CI pipelines
├── docker-compose.yml
└── turbo.json
```

---

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full technical specification including data model, API reference, payment flows, and build plan.

---

## Build phases

Development follows the phased plan in `docs/architecture.md §20`. Current status:

- [x] **Phase 0** — Repo & Tooling
- [ ] Phase 1 — Backend Foundation
- [ ] Phase 2 — Phone OTP Auth
- [ ] Phase 3 — Mobile Foundation
- [ ] Phase 4 — Rooms (Create, Join, Membership)
- [ ] Phase 5 — Payments & Post-Event Paywall
- [ ] Phase 6 — Photo Capture & Upload
- [ ] Phase 7 — Engagement & Downloads
- [ ] Phase 8 — Lifecycle, Retention, Notifications
- [ ] Phase 9 — Security Hardening
- [ ] Phase 10 — Observability & Ops
- [ ] Phase 11 — Release Engineering
- [ ] Phase 12 — Polish & Pre-launch
