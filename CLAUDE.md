# Sher — Claude Code Project Instructions

You are working on **Sher**, a mobile app for collaborative event photography. Read this file at the start of every session.

## Source of truth

The complete technical specification is at **`docs/architecture.md`**. **Read it before writing any code.** Section numbers in this file refer to that document. If anything here conflicts with the architecture doc, the architecture doc wins — but tell the user about the conflict so we can fix it.

## How we work together

- We build this app **one phase at a time** as defined in §20 of the architecture doc.
- Do **not** skip ahead to a later phase. Do **not** mix work from multiple phases in a single change.
- Each phase has explicit "Done when" criteria. We do not move on until those pass.
- When you are unsure about a decision the doc doesn't cover, **stop and ask**. Do not guess.
- Prefer small, focused diffs. One concern per commit.
- Write tests alongside code, not after. A phase is not done if its tests aren't written.

## Stack (locked — see §2 of architecture doc)

- Monorepo: pnpm workspaces + Turborepo
- Mobile: React Native 0.83 + Expo SDK 55 (TypeScript)
- Backend: NestJS (Node 20+, TypeScript) + Prisma + PostgreSQL 16
- Cache/queue: Redis 7 + BullMQ
- Storage: Cloudflare R2 (S3-compatible)
- Real-time: Socket.IO with Redis adapter
- Payments: Paystack (primary) + Flutterwave (fallback), multi-currency
- Auth: Phone OTP via Termii → JWT (RS256 access + rotating refresh)

## Brand & design rules (non-negotiable — see §7.5)

- **No gradients anywhere.** Solid saturated colors only. If you write or generate code that uses `LinearGradient`, `expo-linear-gradient`, CSS `linear-gradient(...)`, or any gradient utility, you have made a mistake — fix it before declaring done.
- Use the color tokens from §7.5. Do not introduce new colors without asking.
- Border radius: 16pt cards, 12pt buttons, 999pt chips.
- Microcopy is warm, casual, second-person. No corporate-speak.

## Pricing model (do not misremember — see §1, §5, §9)

- Rooms are **free to create**. There is no upfront payment.
- The paywall engages **after** the Room ends.
- **Host pays base unlock** (₦1,500 / $1.99 regional equivalent) — unlocks the first 3 members.
- **Extra members (joinOrder > baseCapacity) each self-pay** (₦1,000 / $0.99) for their own access.
- Currency is **locked to the Room at creation**. All members of a Room are charged in that Room's currency.
- The pricing service (`apps/api/src/pricing/`) is the **only** source of amounts. The client never specifies an amount.

## Code conventions

- TypeScript strict mode. **No `any`** unless at a clearly-marked third-party boundary with a comment explaining why.
- Validate every API input with Zod (or class-validator at controllers). Reject unknown fields.
- All money values stored as `amountMinor: number` (kobo, cents, pesewa). Never floats.
- All times are `DateTime` UTC in Postgres. Display in user's local timezone in the mobile app.
- All IDs are cuid (Prisma `@default(cuid())`). No incrementing integers exposed to clients.
- Never log: phone numbers in full, JWT tokens, payment provider secrets, photo bytes. Use pino-redact.
- No raw SQL except in reviewed Prisma migrations. Use the Prisma client for queries.

## Security guardrails

- Never store secrets in the repo. `.env.example` documents required keys; `.env` is gitignored.
- Never trust the client for: payment success, membership state, room status, photo ownership. Verify server-side.
- Webhook handlers must verify signatures before doing anything else.
- Authorization decorators (`@RoomRole`, `@MembershipOwner`, etc.) on every protected endpoint.

## Common commands

These commands are aspirational until Phase 0 is built. Once they exist, use them — do not reinvent them.

```
pnpm install                  # install all workspace deps
pnpm dev                      # start local dev (api + worker + mobile metro)
pnpm test                     # run all tests across workspaces
pnpm lint                     # lint all workspaces
pnpm typecheck                # typecheck all workspaces
pnpm --filter api migrate     # run Prisma migrations
pnpm --filter api seed        # seed dev data
docker compose up -d          # start Postgres + Redis + MinIO locally
```

## How to start a phase

When the user says "start Phase N", do the following:

1. Re-read the relevant sections of `docs/architecture.md` (the phase description + any sections it references).
2. Summarize for me what you understand the phase requires and what you will do. Wait for confirmation before writing code.
3. Implement in small commits with clear messages.
4. Run the test suite. If anything fails, fix it before declaring done.
5. Tell me explicitly which "Done when" criteria from the phase are now met, with evidence (test output, screenshot, etc.).

## When you are stuck or uncertain

- Ask me a single concrete question. Do not produce a long list of clarifying questions.
- Do not invent product behavior to fill ambiguity. The doc + me are the source of truth.
- If a library API has changed and the doc is out of date, point it out — don't silently work around it.

- **Do not push to the GitHub remote.** Commit locally only. I push from my own terminal after reviewing each deliverable.
