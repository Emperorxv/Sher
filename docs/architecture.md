# System Architecture — Shared Event Photo App ("Sher")

> **Product:** Sher. This document is the complete technical specification you can feed to Claude Code in phases. Each phase at the end is self-contained and produces working software. **Version 2.0** — pricing model and payment architecture updated to freemium / post-event paywall with multi-currency.

---

## 1. Product Summary

**Sher** is a mobile app for collaborative event photography. Groups of people at a shared event (parties, weddings, birthdays, conferences, weekend trips) join a temporary "Room" by scanning a QR code. Each member uses their own device's camera _through the app_ to capture photos. All photos in the Room are pooled and accessible to every member.

### Core flows

1. **Host** creates a Room **for free** — no payment up front, instant access. Default capacity is 3 members (host + 2). The host gets a QR code immediately.
2. **Guests** scan the QR code (or enter a 6-character join code), authenticate via phone OTP, join the Room.
   On **first-ever sign-in**, the app immediately prompts for an email address and an optional marketing-consent checkbox. The user is **not blocked** — they proceed into the app the moment OTP verifies. Email verification happens asynchronously (a confirmation link is sent via Resend). Transactional emails (receipts, security alerts) are always sent regardless of `emailVerified` status; marketing emails require `marketingConsent = true`.
3. If the host wants to invite a **4th, 5th, or Nth member**, they are warned in-app that each additional member will cost their guests a small unlock fee at the end of the event. The host can still invite them; the warning is informational, not blocking.
4. Members **capture photos** in-app. Photos upload in the background and appear in a shared gallery for all members in near-real-time. **The gallery is fully visible and usable during the event** — paywall has not engaged yet.
5. When the Room **ends** (host ends it manually or `endsAt` is reached), the gallery becomes **paywalled**:
   - The **host pays a base unlock fee** (₦1,500 / $1.99 / regional equivalent) to unlock the gallery for the original 3 members (host + first 2 guests).
   - Any **4th-and-beyond member** must pay their own per-user unlock fee (₦1,000 / $0.99 / regional equivalent) to access the gallery.
   - Until unlocked, members see locked thumbnails and a paywall sheet. Their own photos are not deleted, just access-gated.
6. Members can apply **filters** before or after capture, like/comment on photos, and **download** originals — but only after their access is unlocked.
7. After the event ends + **30 days** of post-unlock retention, photos are auto-deleted. Any member can pay for a **retention extension** up to 1 year.

### Monetization (free-to-create, pay-to-access)

This is a freemium funnel: zero friction to start a Room → emotional investment is built as photos are captured → the paywall lands at the moment of highest perceived value (when the user wants to _see and keep_ their memories).

- **Free to create.** Host pays nothing to spin up a Room of 3.
- **Base unlock (host-paid):** ₦1,500 / $1.99 — unlocks the gallery for the host and the first 2 guests after the Room ends.
- **Extra-member unlock (per user, self-paid):** ₦1,000 / $0.99 per additional member beyond the first 3. Each extra member pays their own fee to access the gallery.
- **Retention extension:** ₦1,000 / $1.49 per month, ₦8,000 / $9.99 per year. Cap at 365 days past event end.
- **Pricing is shown in the user's local currency** based on their region (see §9.4).

### Key consequence: access is **per-user**, not per-Room

Because some members pay (base 3) via the host and other members (extras) pay themselves, "is this member unlocked?" is a per-membership state, not a per-room state. The data model in §5 reflects this.

---

## 2. Tech Stack — Final Decisions

| Layer                     | Choice                                                                   | Why                                                                            |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Mobile                    | **React Native 0.83 (Expo SDK 55)** with TypeScript                      | One codebase for iOS/Android, mature camera + filter stack, EAS for builds/OTA |
| Camera                    | **react-native-vision-camera v4** + **react-native-skia** for filters    | GPU-accelerated, far superior to expo-camera for this use case                 |
| Mobile state              | **Zustand** (client state) + **TanStack Query** (server state)           | Lightweight, predictable, ideal for offline-first                              |
| Local storage             | **MMKV** (preferences) + **expo-sqlite** (photo queue)                   | MMKV is 30x faster than AsyncStorage                                           |
| Backend framework         | **NestJS** (Node.js 20+, TypeScript)                                     | Opinionated structure, DI, decorators, scales from MVP to enterprise           |
| Database                  | **PostgreSQL 16**                                                        | Relational integrity for memberships, payments, retention                      |
| ORM                       | **Prisma**                                                               | Type-safe queries, migrations, great DX                                        |
| Cache / queue / pubsub    | **Redis 7**                                                              | Sessions, rate limits, BullMQ jobs, pub/sub for real-time                      |
| Object storage            | **Cloudflare R2** (S3-compatible)                                        | **Zero egress fees** — crucial for a download-heavy app                        |
| CDN                       | **Cloudflare**                                                           | Image resizing via Cloudflare Images Transform, global edge                    |
| Image processing (server) | **sharp** (libvips)                                                      | Thumbnail/medium variants on upload                                            |
| Real-time                 | **Socket.IO** (Redis adapter)                                            | Reliable, handles reconnect, fallbacks                                         |
| Push notifications        | **Expo Push Service** → APNS + FCM                                       | Single API, free, abstracts platform differences                               |
| Background jobs           | **BullMQ** (Redis-backed)                                                | Scheduled deletion, payment reconciliation, notifications                      |
| Auth                      | Phone + OTP (Termii/Africa's Talking), JWT (access + refresh)            | Phone-first identity is dominant in NG                                         |
| Payments                  | **Paystack** (primary) + **Flutterwave** (fallback)                      | Cards, USSD, bank transfer, mobile money                                       |
| Email (receipts)          | **Resend** or **AWS SES**                                                | Transactional only                                                             |
| Observability             | **Sentry** (errors), **BetterStack** (logs), **Grafana Cloud** (metrics) | Free tiers cover MVP, scale up later                                           |
| Hosting (compute)         | **AWS ECS Fargate** _or_ **DigitalOcean App Platform**                   | Both fine; DO is cheaper for early stage                                       |
| IaC                       | **Terraform**                                                            | Reproducible infra, multi-environment                                          |
| CI/CD                     | **GitHub Actions** + **EAS Build/Submit**                                | Standard, free for private repos under limits                                  |
| Secrets                   | **AWS Secrets Manager** _or_ **Doppler**                                 | Never `.env` in repo                                                           |

### Why not Flutter / native?

- Flutter is fine; the deciding factor is hiring + ecosystem. React Native has a much larger Nigerian developer pool and an unmatched library ecosystem for camera/filters specifically.
- Native (Swift + Kotlin) doubles build time, doubles bug surface, doubles team cost. Not justified for this product.

---

## 3. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          MOBILE CLIENTS                              │
│  React Native (iOS + Android)                                        │
│  ├─ Vision Camera (capture)                                          │
│  ├─ Skia filters (GPU)                                               │
│  ├─ Upload queue (SQLite + BullMQ-style retry on device)             │
│  └─ Socket.IO client (live gallery)                                  │
└──────────────┬───────────────────────────────────────────────────────┘
               │ HTTPS (TLS 1.3) + WSS
               │ Certificate pinning
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       CLOUDFLARE EDGE                                │
│  WAF · DDoS · Rate limiting · TLS · CDN · Image Resizing             │
└──────────────┬─────────────────────────────────┬─────────────────────┘
               │                                 │
               ▼                                 ▼
┌─────────────────────────────────┐   ┌──────────────────────────────┐
│      API GATEWAY (NestJS)       │   │    R2 OBJECT STORAGE         │
│  ┌─────────┐  ┌──────────┐      │   │  /originals/{room}/{photo}   │
│  │  Auth   │  │  Rooms   │      │   │  /thumbs/{room}/{photo}      │
│  ├─────────┤  ├──────────┤      │   │  /medium/{room}/{photo}      │
│  │  Photos │  │ Payments │      │   │  (private; signed URLs)      │
│  ├─────────┤  ├──────────┤      │   └──────────────────────────────┘
│  │ Realtime│  │ Webhooks │      │
│  └─────────┘  └──────────┘      │
└──┬────────────────┬─────────────┘
   │                │
   ▼                ▼
┌────────────┐  ┌────────────┐
│ PostgreSQL │  │   Redis    │  ← BullMQ workers (separate process)
│  (primary  │  │ (cache,    │     ├─ Image post-processing
│   + read   │  │  queue,    │     ├─ Push notifications
│   replica) │  │  pubsub)   │     ├─ Scheduled deletion
└────────────┘  └────────────┘     ├─ Payment reconciliation
                                   └─ Retention expiry warnings

External services:
  Paystack/Flutterwave (payments) · Termii (SMS OTP) · Expo Push · Sentry · Resend
```

---

## 4. Monorepo Layout

Use **pnpm workspaces** + **Turborepo**.

```
sher/
├── apps/
│   ├── mobile/                   # Expo React Native app
│   ├── api/                      # NestJS REST + WebSocket API
│   ├── worker/                   # NestJS standalone, BullMQ consumer
│   └── admin/                    # (Phase 2) Next.js internal dashboard
├── packages/
│   ├── shared-types/             # Zod schemas, DTOs, shared TS types
│   ├── api-client/               # Generated typed client for mobile
│   ├── ui/                       # Shared RN components (optional)
│   └── config/                   # ESLint, TS, Prettier presets
├── infra/
│   ├── terraform/                # IaC
│   └── docker/                   # Dockerfiles, compose
├── .github/workflows/            # CI pipelines
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

Shared types live in `packages/shared-types` and are imported by both `apps/api` and `apps/mobile` so request/response shapes can never drift.

---

## 5. Domain Model & Database Schema

### Entities

**User** — a person. One per phone number.
**Room** — a single event. Has a host, a join code, a plan tier, a lifecycle.
**Membership** — links User ↔ Room with a role (host/co-host/guest).
**Photo** — uploaded media tied to a Room and an uploader.
**PhotoReaction** — likes (extensible to comments).
**Payment** — every money movement (event fee, upgrade, retention).
**RetentionWindow** — when a Room's photos expire. Extensible.
**DeviceToken** — push tokens per user per device.
**AuditLog** — security-sensitive events.

### Prisma schema (`apps/api/prisma/schema.prisma`)

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum UserStatus      { ACTIVE SUSPENDED DELETED }
enum RoomStatus      { DRAFT ACTIVE ENDED EXPIRED ARCHIVED }
enum Role            { HOST COHOST GUEST }
enum PhotoStatus     { UPLOADING READY FAILED DELETED FLAGGED }
enum PaymentProvider { PAYSTACK FLUTTERWAVE }
enum PaymentStatus   { PENDING SUCCESS FAILED REFUNDED }
enum PaymentPurpose  { BASE_UNLOCK MEMBER_UNLOCK RETENTION_EXTENSION }
enum Platform        { IOS ANDROID }
enum UnlockState     { LOCKED UNLOCKED EXEMPT }    // EXEMPT = covered by base unlock (first 3 members)

model User {
  id            String   @id @default(cuid())
  phone         String   @unique               // E.164 e.g. +2348012345678
  email         String   @unique               // Required; collected post-OTP, verified asynchronously
  emailVerified Boolean  @default(false)
  marketingConsent Boolean @default(false)
  displayName   String?
  avatarUrl     String?
  status        UserStatus @default(ACTIVE)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime?

  hostedRooms   Room[]         @relation("RoomHost")
  memberships   Membership[]
  photos        Photo[]
  payments      Payment[]
  deviceTokens  DeviceToken[]
  reactions     PhotoReaction[]

  @@index([phone])
}

model Room {
  id              String      @id @default(cuid())
  name            String
  hostId          String
  host            User        @relation("RoomHost", fields: [hostId], references: [id])
  joinCode        String      @unique               // 6-char A-Z0-9, no ambiguous chars
  qrSecret        String                            // signed payload component
  baseCapacity    Int         @default(3)           // first N members covered by host's BASE_UNLOCK
  status          RoomStatus  @default(DRAFT)
  startsAt        DateTime
  endsAt          DateTime                          // capture window closes here
  endedAt         DateTime?                         // when status actually became ENDED (paywall engages)
  baseUnlockedAt  DateTime?                         // when host successfully paid BASE_UNLOCK
  baseUnlockPaymentId String?                       // FK to Payment that unlocked the base members
  retentionUntil  DateTime                          // photos auto-delete after this (computed from endedAt + 30d + extensions)
  coverPhotoId    String?
  pricingCurrency String      @default("NGN")       // currency captured at room creation for consistency
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  memberships     Membership[]
  photos          Photo[]
  payments        Payment[]
  retentionWindows RetentionWindow[]

  @@index([joinCode])
  @@index([status, retentionUntil])
}

model Membership {
  id            String       @id @default(cuid())
  roomId        String
  userId        String
  role          Role         @default(GUEST)
  joinOrder     Int                                  // 1, 2, 3, ... — determines if EXEMPT (≤baseCapacity) or needs MEMBER_UNLOCK
  unlockState   UnlockState  @default(LOCKED)        // LOCKED until room ends or payment processed
  unlockedAt    DateTime?                            // when this membership gained gallery access
  unlockPaymentId String?                            // FK to MEMBER_UNLOCK Payment (null for EXEMPT)
  joinedAt      DateTime     @default(now())
  leftAt        DateTime?
  room          Room         @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user          User         @relation(fields: [userId], references: [id])

  @@unique([roomId, userId])
  @@unique([roomId, joinOrder])
  @@index([userId])
}

model Photo {
  id              String       @id @default(cuid())
  roomId          String
  uploaderId      String
  storageKey      String       // R2 object key (originals/{room}/{id}.jpg)
  thumbKey        String?
  mediumKey       String?
  mimeType        String
  sizeBytes       Int
  width           Int?
  height          Int?
  takenAt         DateTime?    // EXIF or upload time
  filter          String?      // filter id applied client-side
  status          PhotoStatus  @default(UPLOADING)
  flagReason      String?      // moderation
  deletedAt       DateTime?
  createdAt       DateTime     @default(now())

  room       Room            @relation(fields: [roomId], references: [id], onDelete: Cascade)
  uploader   User            @relation(fields: [uploaderId], references: [id])
  reactions  PhotoReaction[]

  @@index([roomId, createdAt(sort: Desc)])
  @@index([uploaderId])
  @@index([status])
}

model PhotoReaction {
  id        String   @id @default(cuid())
  photoId   String
  userId    String
  type      String   @default("LIKE")
  createdAt DateTime @default(now())
  photo     Photo    @relation(fields: [photoId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id])
  @@unique([photoId, userId, type])
}

model Payment {
  id              String           @id @default(cuid())
  userId          String                                   // who paid
  roomId          String?                                  // for BASE_UNLOCK / RETENTION_EXTENSION
  membershipId    String?                                  // for MEMBER_UNLOCK — exact target
  provider        PaymentProvider
  providerRef     String           @unique                 // Paystack reference
  amountMinor     Int                                      // smallest unit (kobo, cents, pesewa, etc.)
  currency        String                                   // ISO 4217: NGN, USD, GHS, KES, ZAR, GBP, EUR
  fxLockedRate    Decimal?         @db.Decimal(18, 8)      // FX rate snapshot if conversion was applied
  status          PaymentStatus    @default(PENDING)
  purpose         PaymentPurpose
  metadata        Json?
  paidAt          DateTime?
  createdAt       DateTime         @default(now())
  user            User             @relation(fields: [userId], references: [id])
  room            Room?            @relation(fields: [roomId], references: [id])

  @@index([userId])
  @@index([roomId])
  @@index([membershipId])
  @@index([status])
}

model RetentionWindow {
  id          String   @id @default(cuid())
  roomId      String
  extendsTo   DateTime
  paymentId   String?
  createdAt   DateTime @default(now())
  room        Room     @relation(fields: [roomId], references: [id], onDelete: Cascade)
}

model DeviceToken {
  id         String   @id @default(cuid())
  userId     String
  token      String   @unique
  platform   Platform
  lastSeenAt DateTime @default(now())
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model OtpChallenge {
  id          String   @id @default(cuid())
  phone       String
  codeHash    String
  attempts    Int      @default(0)
  expiresAt   DateTime
  consumedAt  DateTime?
  createdAt   DateTime @default(now())
  @@index([phone, createdAt(sort: Desc)])
}

model AuditLog {
  id        String   @id @default(cuid())
  actorId   String?
  action    String
  entity    String
  entityId  String?
  ip        String?
  userAgent String?
  metadata  Json?
  createdAt DateTime @default(now())
  @@index([actorId, createdAt(sort: Desc)])
  @@index([entity, entityId])
}
```

### Pricing — Final

The user has set these prices. They are the source of truth (override the per-currency suggestions only with the user's approval).

#### NGN (Nigeria — primary market)

| Fee                       | Amount (NGN)                  | Paid by     | When                 |
| ------------------------- | ----------------------------- | ----------- | -------------------- |
| Base unlock (members 1–3) | ₦1,500                        | Host        | After Room ends      |
| Per extra member unlock   | ₦1,000                        | That member | After Room ends      |
| Retention extension       | ₦1,000 / month, ₦8,000 / year | Any member  | Anytime after unlock |

#### Multi-currency price book (initial)

These are **regional psychological prices**, not strict FX conversions of NGN. Stored as a versioned `PriceBook` in code (`apps/api/src/pricing/price-book.ts`); editable without a migration.

| Currency                | Base unlock | Extra member unlock | Retention / mo | Retention / yr |
| ----------------------- | ----------- | ------------------- | -------------- | -------------- |
| **NGN** (Nigeria)       | 1,500       | 1,000               | 1,000          | 8,000          |
| **USD** (US + fallback) | 1.99        | 0.99                | 1.49           | 9.99           |
| **GHS** (Ghana)         | 24          | 16                  | 18             | 119            |
| **KES** (Kenya)         | 259         | 159                 | 199            | 1,299          |
| **ZAR** (South Africa)  | 36          | 24                  | 27             | 179            |
| **GBP** (UK)            | 1.59        | 0.79                | 1.19           | 7.99           |
| **EUR** (Eurozone)      | 1.79        | 0.89                | 1.39           | 8.99           |

**Currency selection rules** (in priority order, evaluated at Room creation and persisted on `Room.pricingCurrency`):

1. User has manually overridden currency in Settings → use that.
2. SIM country code (where available via the OS) matches a supported currency → use it.
3. IP-based geolocation country → maps to a supported currency.
4. Phone number country code → maps to a supported currency.
5. Fall back to USD.

The currency is **locked at Room creation**. All members of the same Room are charged in that Room's currency, regardless of where individual extra members live. This prevents bizarre situations like one member paying USD and another paying NGN for the same Room and simplifies accounting.

### Membership unlock state machine

Every Membership transitions through these states:

```
                ┌─────────────────────────────────────────┐
                │ Joins room                              │
                ▼                                         │
   joinOrder ≤ Room.baseCapacity?                         │
        │                                                 │
   ┌────┴────┐                                            │
   YES       NO                                           │
   │         │                                            │
   ▼         ▼                                            │
 LOCKED   LOCKED                                          │
   │         │                                            │
   │  (Room ends)                                         │
   │         │                                            │
   ▼         ▼                                            │
 LOCKED   LOCKED  ──── user pays MEMBER_UNLOCK ──► UNLOCKED
   │
   └── host pays BASE_UNLOCK ──► all joinOrder ≤ baseCapacity transition to EXEMPT (full access)
```

- `EXEMPT` and `UNLOCKED` both grant gallery access. The distinction exists for accounting / reporting.
- A member can capture photos while LOCKED; they just cannot view the full-resolution gallery once the Room ends.
- During the active capture window (`Room.status = ACTIVE`), all members can view photos regardless of unlock state. The paywall **only engages at end-of-event**.

---

## 6. API Specification

Base URL: `https://api.sher.app/v1`
Auth: `Authorization: Bearer <jwt>`
Content type: `application/json` (uploads use multipart or pre-signed PUT)
All responses follow:

```ts
// Success
{ "data": T, "meta"?: { ... } }
// Error
{ "error": { "code": "ROOM_FULL", "message": "...", "details"?: {...} } }
```

### Auth

| Method | Path                 | Purpose                                                                                               |
| ------ | -------------------- | ----------------------------------------------------------------------------------------------------- |
| POST   | `/auth/otp/request`  | `{ phone }` → sends OTP, returns `challengeId`                                                        |
| POST   | `/auth/otp/verify`   | `{ challengeId, code }` → `{ accessToken, refreshToken, user, isNewUser }`                            |
| POST   | `/auth/refresh`      | `{ refreshToken }` → new pair                                                                         |
| POST   | `/auth/logout`       | revokes refresh token                                                                                 |
| POST   | `/auth/email/verify` | `{ token }` (from email link) → sets `User.emailVerified = true`; token is signed, 15-min, single-use |
| POST   | `/auth/email/resend` | resend verification email (3 per user per hour)                                                       |
| POST   | `/auth/devices`      | register Expo push token                                                                              |
| DELETE | `/auth/devices/:id`  | unregister                                                                                            |
| DELETE | `/auth/account`      | soft-delete (NDPR right to erasure)                                                                   |

### Users

| Method | Path                    | Purpose                                                        |
| ------ | ----------------------- | -------------------------------------------------------------- |
| GET    | `/me`                   | current profile + active rooms                                 |
| PATCH  | `/me`                   | update `displayName`, `avatarUrl`, `email`, `marketingConsent` |
| POST   | `/me/avatar/upload-url` | presigned PUT for avatar                                       |

### Rooms

| Method | Path                          | Purpose                                                                                                    |
| ------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| POST   | `/rooms`                      | create Room (free, returns immediately ACTIVE with QR + price quote in local currency)                     |
| GET    | `/rooms/:id`                  | room detail (members, status, photo count, current user's unlock state)                                    |
| PATCH  | `/rooms/:id`                  | host edits name/end time (limited fields, only while ACTIVE)                                               |
| GET    | `/rooms/:id/members`          | paginated members with `joinOrder` and `unlockState`                                                       |
| DELETE | `/rooms/:id/members/:userId`  | host removes a member (only while ACTIVE, before they've captured)                                         |
| POST   | `/rooms/join`                 | `{ joinCode \| qrToken }` → membership; response includes whether this user will need to pay MEMBER_UNLOCK |
| POST   | `/rooms/:id/end`              | host ends capture early → engages paywall                                                                  |
| GET    | `/rooms/:id/pricing`          | returns the current Room's pricing in its locked currency                                                  |
| POST   | `/rooms/:id/retention/extend` | `{ months: 1..12 }` → payment intent (any unlocked member can pay)                                         |
| GET    | `/rooms`                      | my rooms (hosted + member)                                                                                 |

### Unlocks (new — post-event paywall)

| Method | Path                       | Purpose                                                                                                 |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| POST   | `/rooms/:id/unlock/base`   | host initiates BASE_UNLOCK payment → returns Paystack authorization URL                                 |
| POST   | `/rooms/:id/unlock/member` | non-exempt member (joinOrder > baseCapacity) initiates MEMBER_UNLOCK for themselves                     |
| GET    | `/rooms/:id/unlock/status` | current unlock posture for the caller (`LOCKED` / `UNLOCKED` / `EXEMPT`) plus host's BASE_UNLOCK status |

### Pricing

| Method | Path                  | Purpose                                                                  |
| ------ | --------------------- | ------------------------------------------------------------------------ |
| GET    | `/pricing/quote`      | `?currency=NGN&extraMembers=2` → quote for Room creation paywall preview |
| GET    | `/pricing/currencies` | supported currencies + display labels                                    |

### Photos

| Method | Path                                | Purpose                                                              |
| ------ | ----------------------------------- | -------------------------------------------------------------------- |
| POST   | `/rooms/:id/photos/upload-url`      | request a presigned PUT to R2; returns `{ uploadUrl, photoId, key }` |
| POST   | `/rooms/:id/photos/:photoId/commit` | client tells API upload finished; API enqueues post-processing       |
| GET    | `/rooms/:id/photos`                 | paginated gallery (cursor-based, newest first)                       |
| GET    | `/rooms/:id/photos/:photoId`        | single photo (signed URLs for thumb/medium/original)                 |
| POST   | `/rooms/:id/photos/:photoId/like`   | toggle like                                                          |
| DELETE | `/rooms/:id/photos/:photoId`        | uploader or host can delete                                          |
| POST   | `/rooms/:id/photos/:photoId/flag`   | report; moves to moderation queue                                    |
| GET    | `/rooms/:id/photos/bulk-download`   | generates a zip; returns job id + poll URL                           |

### Webhooks (server-to-server)

| Method | Path                    | From                                          |
| ------ | ----------------------- | --------------------------------------------- |
| POST   | `/webhooks/paystack`    | Paystack — verify with `x-paystack-signature` |
| POST   | `/webhooks/flutterwave` | Flutterwave — verify with `verif-hash`        |

### Realtime (Socket.IO namespaces)

- Namespace: `/rooms`
- Auth: JWT in `auth.token` on handshake
- Rooms (Socket.IO rooms) mirror DB rooms: `room:{roomId}`
- Events emitted to clients:
  - `photo:new` — `{ photoId, thumbUrl, uploader }`
  - `photo:deleted` — `{ photoId }`
  - `member:joined` — `{ user }`
  - `member:left` — `{ userId }`
  - `room:ended`, `room:expiring` (7 days before retention end)
- Server uses Redis adapter so multiple API pods broadcast correctly.

### Rate limits (per IP + per user)

| Endpoint group      | Limit                                         |
| ------------------- | --------------------------------------------- |
| `/auth/otp/request` | 3 per phone per hour, 10 per IP per hour      |
| `/auth/otp/verify`  | 5 per challenge, then challenge invalidated   |
| Photo upload URLs   | 300 per room per hour, 60 per user per minute |
| Default             | 120/min per user                              |

Implemented via `@nestjs/throttler` + Redis store.

---

## 7. Mobile App — Structure

### Navigation tree (Expo Router file-based)

```
app/
├── (auth)/
│   ├── welcome.tsx
│   ├── phone.tsx
│   └── verify.tsx
├── (tabs)/
│   ├── _layout.tsx              # bottom tabs
│   ├── index.tsx                # "My Rooms"
│   ├── create.tsx               # Create / host
│   └── profile.tsx
├── room/
│   ├── [id]/
│   │   ├── index.tsx            # Gallery
│   │   ├── camera.tsx           # Capture
│   │   ├── members.tsx
│   │   ├── settings.tsx         # host-only
│   │   └── photo/[photoId].tsx  # Full view + edit/filter
├── join/
│   ├── scan.tsx                 # QR scanner
│   └── code.tsx                 # Manual code entry
├── checkout/
│   └── [paymentRef].tsx         # Paystack inline / webview
└── _layout.tsx                  # root: providers, deep links
```

### Key components

- `CameraScreen` — Vision Camera with overlay, filter carousel, capture button, gallery thumb of last shot, queue badge.
- `FilterPipeline` — Skia ImageFilter graph. Each filter is a named function `(ImageShader) => ImageShader`. Applied at capture-time for preview, at save-time for the JPEG.
- `UploadQueue` — singleton service: enqueues to SQLite, retries with exponential backoff, surfaces progress via Zustand store, resumes on app launch.
- `GalleryGrid` — FlashList (Shopify), virtualized, prefetches medium variants, opens swipeable viewer.
- `PaywallSheet` — bottom sheet showing price tiers; calls `/rooms/:id/checkout`.

### State management split

- **Server state:** TanStack Query, keys mirror REST paths, websocket events invalidate relevant queries (`['rooms', roomId, 'photos']` etc.)
- **Client state (Zustand):** auth tokens, upload queue, camera settings, theme
- **Persisted:** auth (Keychain/Keystore), preferences (MMKV), upload queue (SQLite)

### Filter set (initial 8)

Implemented in Skia shaders so they run on the GPU:

1. Original (no-op)
2. Warm
3. Cool
4. B&W (luminance)
5. Vivid (saturation boost)
6. Fade (lifted blacks, lowered contrast)
7. Soft glow (gaussian + screen blend)
8. Vignette + grain

Each is `~30-80 lines` of Skia code. Filters are version-stamped (`filter: "fade@1"`) so re-runs are reproducible.

### Offline-first capture

1. User taps shutter → frame saved to `FileSystem.documentDirectory/queue/{uuid}.jpg`
2. Row inserted in SQLite `upload_queue` with `status=pending`
3. Network observer picks up rows, requests presigned URL, PUTs to R2, calls `/commit`
4. On success: SQLite row deleted, local file removed
5. On 5xx: exponential backoff with jitter (max 5 attempts, 2h ceiling)
6. On 4xx (e.g. quota): row marked `failed`, user notified

---

## 7.5 Brand Identity & Design System (Sher)

**Personality:** Fun, energetic, celebratory, friendly. The app should feel like a party, not a productivity tool.

**Visual rules:**

- **Full saturated colors only — no gradients anywhere.** Solid color fills only. This is a hard rule per product direction.
- High contrast. Bold color blocks. Generous whitespace around vivid surfaces.
- Playful but not childish. Think Polaroid, party invites, mixtape covers — not kids' toys.
- Decorative angles, slight rotations on stickers and chips, confetti motifs sparingly.

### Color tokens

These are starter values — tune in the design tool, then sync back to code. Stored in `apps/mobile/theme/tokens.ts` and `packages/ui/tokens.ts`.

| Token            | Hex       | Usage                                                                      |
| ---------------- | --------- | -------------------------------------------------------------------------- |
| `colors.primary` | `#FF3B6B` | Main brand color (coral pink). Primary buttons, brand mark, active states. |
| `colors.accent`  | `#FFD60A` | Sunshine yellow. Highlights, badges, "new" indicators.                     |
| `colors.success` | `#00C4B8` | Electric teal. Success states, paid/unlocked indicators.                   |
| `colors.violet`  | `#7B2CBF` | Deep purple. Secondary actions, host badge.                                |
| `colors.coal`    | `#0A0A0A` | Near-black. Body text, primary content.                                    |
| `colors.cream`   | `#FFF8F0` | Warm off-white. Default background.                                        |
| `colors.ink`     | `#1A1A1A` | Cards on cream, alt surfaces.                                              |
| `colors.fog`     | `#E8E4DE` | Borders, dividers, disabled.                                               |
| `colors.danger`  | `#E53935` | Destructive actions, errors.                                               |

**No gradient utilities exist in the design system.** If a Claude Code output uses `LinearGradient`, `expo-linear-gradient`, or CSS `background: linear-gradient(...)`, reject it.

### Typography

- **Display / Headings:** `Cabinet Grotesk` (or `Recoleta` if licensing easier) — geometric, friendly, bold weights only for headings.
- **Body:** `Inter` — clean, multi-script, great Naira/dollar number rendering.
- **Mono (optional):** `JetBrains Mono` — for join codes ("ABC4F7").

Type scale (in pt, mobile):

- Display: 40 / 32 / 26
- Heading: 22 / 18
- Body: 16 / 14
- Caption: 12
- Join code (special): 32, monospace, letter-spaced

### Component conventions

- **Border radius:** 16pt for cards, 12pt for buttons, 999pt for chips/pills.
- **Buttons:** solid color fill, no shadow, slight scale-down on press, haptic on tap.
- **Cards:** solid background (cream or color), no shadow on light surfaces, 1pt fog border optional.
- **Stickers:** small color chips rotated −4° to 4°, used for "Host", "You", "Unlocked", "Locked", "+2 new".
- **Icons:** chunky, filled, weight-matched to type (Phosphor "Fill" set works well).
- **Empty states:** illustrated with simple geometric shapes in brand colors; one-line copy that's warm and conversational ("No photos yet. Snap something!").

### Microcopy voice

- Casual, second-person, contractions OK.
- Avoid corporate-speak. Say "Locked" not "Access restricted". Say "Pay ₦1,500 to unlock" not "Complete transaction".
- Celebrate moments: "🎉 You're in!" when joining, "Photos unlocked!" when payment succeeds.
- Don't be cute about money — when showing prices, be plain and clear.

### Accessibility (non-negotiable, even with the fun look)

- All color combinations meet WCAG AA contrast (4.5:1 normal text, 3:1 large text).
- Primary on cream: 4.6:1 ✓. Coal on cream: 18:1 ✓. Pre-test all combinations and add them to a Storybook contrast audit page.
- Dynamic Type support on iOS; `allowFontScaling` honored on Android.
- All tappable targets ≥44×44 pt.
- Color is never the only signal — pair with icons or text (e.g., the lock icon + "Locked" label).

### Dark mode

Phase 2. Keep tokens namespaced so swapping later is mechanical.

---

## 8. Authentication & Authorization

### Phone-OTP flow

1. Client posts `{ phone }` to `/auth/otp/request`.
2. API:
   - Normalizes to E.164.
   - Rate-limits (see §6).
   - Generates 6-digit code, hashes with bcrypt, stores `OtpChallenge` (10 min expiry).
   - Sends SMS via Termii (Africa-focused, dual-route SMS for NG).
   - Returns `{ challengeId }` (does NOT return the code).
3. Client posts `{ challengeId, code }` to `/auth/otp/verify`.
4. API verifies, increments `attempts`, locks out after 5 wrong tries.
5. On success: upserts `User`, issues JWT pair.
6. **New user** (`isNewUser: true` in response): `POST /auth/otp/verify` accepts `{ challengeId, code, email, marketingConsent? }` — `email` is **required** when this is a first-time sign-up and is stored on the User record immediately. `marketingConsent` defaults to `false` if omitted. API enqueues an async email confirmation job (Resend stub in Phase 2). Returning users do not need to supply `email` in this request.

### JWT design

- **Access token:** 15 min, signed RS256, claims: `sub`, `phone`, `roles`, `jti`, `iat`, `exp`
- **Refresh token:** 30 days, opaque random string, stored hashed in `refresh_tokens` table with `revokedAt`; **rotated on every use** (reuse detection → revoke entire family).
- Stored client-side in **expo-secure-store** (Keychain / Android Keystore). Never in AsyncStorage/MMKV.

### Authorization

Two-tier:

1. **Authentication guard** — every endpoint except `/auth/*` and `/health`.
2. **Resource policies** — NestJS `@RoomRole(Role.HOST)` decorator + guard pulls `Membership` from `req.user.id` + path `:roomId`.

Examples:

- Anyone authenticated can `POST /rooms` (create draft).
- Only members can `GET /rooms/:id`.
- Only host/cohost can `PATCH /rooms/:id`, end, upgrade, remove members.
- Only uploader or host can delete a photo.

### Token revocation

- Refresh tokens: stored, can be revoked individually or by family.
- Access tokens: short TTL avoids the need for a denylist; for emergency revocation (suspended user), maintain a Redis set `revoked_jti` with TTL = access token TTL.

---

## 9. Payment Integration

### 9.1 Why Paystack as the global processor

Paystack now supports international cards through their global merchant configuration, and they natively settle in NGN, GHS, KES, ZAR, and (via international acquiring) USD. For Sher's global launch, **Paystack is the single primary processor**; Flutterwave remains as a fallback that the user can switch to at the paywall sheet if Paystack fails or rejects their card. Both implement the same `PaymentProvider` interface in code so the rest of the system is provider-agnostic.

### 9.2 The freemium / post-event paywall flow

Unlike a traditional "pay before use" model, Sher charges **only after the user has emotional investment in the captured photos**. There is no checkout when creating a Room. Payments happen at two moments:

**Moment A — Room ends → Host pays BASE_UNLOCK**

```
Host                        API                              Paystack
 │                           │                                 │
 │ POST /rooms/:id/end       │                                 │
 ├──────────────────────────►│  Room.status = ENDED            │
 │                           │  Room.endedAt = now             │
 │                           │  Emit room:ended (socket+push)  │
 │ ◄── 200, paywall data ────│                                 │
 │                           │                                 │
 │ Sees paywall sheet        │                                 │
 │ Taps "Unlock for ₦1,500"  │                                 │
 │                           │                                 │
 │ POST /rooms/:id/unlock/base                                 │
 ├──────────────────────────►│  Create Payment(BASE_UNLOCK,    │
 │                           │    amountMinor=150000,          │
 │                           │    currency=Room.pricingCurrency)│
 │                           │  POST /transaction/initialize   │
 │                           ├────────────────────────────────►│
 │                           │ ◄── authorization_url           │
 │ ◄── { url, reference } ───│                                 │
 │ Opens in-app browser     ────── user pays ───────────────► │
 │                           │ ◄── webhook charge.success ─────│
 │                           │ Verify signature + amount       │
 │                           │ GET /transaction/verify/:ref    │
 │                           ├────────────────────────────────►│
 │                           │ ◄── verified payload            │
 │                           │ Mark Payment SUCCESS            │
 │                           │ Room.baseUnlockedAt = now       │
 │                           │ All Memberships where joinOrder │
 │                           │   ≤ baseCapacity → EXEMPT       │
 │                           │ Emit room:base_unlocked         │
 │                           │ Push "Photos are ready!" to 3   │
```

**Moment B — Extra member pays MEMBER_UNLOCK (independently, at their own pace)**

Identical shape, but `/unlock/member`, `MEMBER_UNLOCK` purpose, amount = per-member fee in Room currency, targets only that member's `Membership.unlockState`. Other extras are unaffected.

### 9.3 Pricing service (server-side, source of truth)

A pure module `apps/api/src/pricing/`:

```ts
// price-book.ts
export const PRICE_BOOK = {
  NGN: { baseUnlock: 150000, memberUnlock: 100000, retentionMonth: 100000, retentionYear: 800000 },
  USD: { baseUnlock: 199, memberUnlock: 99, retentionMonth: 149, retentionYear: 999 },
  GHS: { baseUnlock: 2400, memberUnlock: 1600, retentionMonth: 1800, retentionYear: 11900 },
  KES: { baseUnlock: 25900, memberUnlock: 15900, retentionMonth: 19900, retentionYear: 129900 },
  ZAR: { baseUnlock: 3600, memberUnlock: 2400, retentionMonth: 2700, retentionYear: 17900 },
  GBP: { baseUnlock: 159, memberUnlock: 79, retentionMonth: 119, retentionYear: 799 },
  EUR: { baseUnlock: 179, memberUnlock: 89, retentionMonth: 139, retentionYear: 899 },
} as const;
// values are in the currency's smallest unit (kobo, cents, pesewa, etc.)
```

```ts
// pricing.service.ts
quote({ currency, purpose, retentionMonths }): { amountMinor, currency, display }
resolveCurrency({ user, room, ip, headers }): SupportedCurrency
formatDisplay({ amountMinor, currency }): string  // e.g. "₦1,500.00", "$1.99"
```

The pricing service is the ONLY place that decides amounts. All payment-creating endpoints call it; the client never specifies an amount.

### 9.4 Currency resolution

Implemented as a single deterministic function `resolveCurrency(input)`:

```
function resolveCurrency(input):
  1. if user.preferredCurrency in SUPPORTED: return it
  2. if room && room.pricingCurrency: return it          // for endpoints scoped to a room
  3. simCountry = device-reported MCC if available; map → currency
  4. ipCountry = MaxMind GeoIP2 lookup on request IP; map → currency
  5. phoneCountry = libphonenumber on user.phone; map → currency
  6. return "USD"
```

Country→currency mapping table lives next to PRICE_BOOK. Unsupported regions all fall through to USD.

The mobile app caches the resolved currency for offline pricing display, but the server always re-resolves on payment-creating endpoints.

### 9.5 Server-side rules (critical, don't skip)

1. **Never trust the client** that payment succeeded. Webhook + explicit verify call is the source of truth.
2. **Verify webhook signatures.** Paystack: HMAC-SHA512 of body with secret key, compared to `x-paystack-signature`. Flutterwave: `verif-hash` header equals your configured secret.
3. **Idempotency.** Webhooks can fire twice. `Payment.providerRef` is unique; if already `SUCCESS`, no-op.
4. **Amount + currency check.** Verified amount and currency from the provider must match the Payment row exactly. Reject mismatches and alert. This defends against tampering and against switching currencies mid-flow.
5. **Authorization check.** A user can only pay BASE_UNLOCK for a Room they host. A user can only pay MEMBER_UNLOCK for their own membership. Enforced server-side.
6. **Reconciliation job.** Hourly BullMQ job: for every `PENDING` payment older than 30 min, call provider verify and resolve.
7. **Idempotent state transitions.** Granting unlock is idempotent: if `Membership.unlockState` is already UNLOCKED, no-op (just log).
8. **Refunds.** Manual via admin in MVP; full API in Phase 2. A refund reverses the unlock state.
9. **PCI scope.** You never see or store card data. Paystack and Flutterwave handle SAQ-A scope. Do not build your own card form.

### 9.6 Endpoint shapes

```ts
// POST /v1/rooms/:roomId/unlock/base
// Auth: must be host of room. Room must be ENDED. Base must not already be unlocked.
Response: {
  paymentId: string,
  authorizationUrl: string,    // open in in-app browser
  providerRef: string,
  amountMinor: number,
  currency: string,
  amountDisplay: string,       // "₦1,500.00"
}

// POST /v1/rooms/:roomId/unlock/member
// Auth: must be a member of room with joinOrder > baseCapacity and unlockState = LOCKED.
// Same response shape.

// POST /v1/webhooks/paystack
// No client auth. Verified via x-paystack-signature.
// Handles charge.success → grants unlock based on Payment.purpose + targets.
```

### 9.7 Edge cases handled

- **Host abandons after Room ends:** members can still see locked thumbnails. After retention expiry, photos delete normally. Host can come back any time before deletion and pay to unlock.
- **Member tries to pay before Room ends:** rejected (`ROOM_STILL_ACTIVE`).
- **Two members race to pay retention extension:** only one Payment succeeds against the same `providerRef`; the other gets a fresh reference. Both money flows are recorded; both members get a thank-you. Retention extends by the sum of both, capped at 365 days.
- **Currency mismatch attempt:** if a request hits the API with a currency different from `Room.pricingCurrency`, the server rejects with `CURRENCY_LOCKED`.
- **Paystack outage:** client surfaces "Try Flutterwave instead" after one failed Paystack init.

### 9.8 Receipts

Successful payments trigger an email receipt via Resend (transactional — always sent to the user's email regardless of `emailVerified` status) and a push notification. Receipt includes: payment ID, room name, purpose, amount + currency, date, support link. Receipts are also accessible in-app under Profile → Payments.

---

## 10. Photo Storage & Processing

### Upload — presigned PUT

1. Client requests `POST /rooms/:id/photos/upload-url` with `{ mimeType, sizeBytes, takenAt, filter }`.
2. API validates:
   - Membership in room.
   - Room status = `ACTIVE` and `now < endsAt`.
   - Photo count not over plan cap.
   - Size ≤ 25 MB, MIME in `image/jpeg|image/heic|image/png`.
3. API inserts `Photo` row with status `UPLOADING`, generates R2 key `originals/{roomId}/{photoId}.jpg`, returns presigned PUT URL (15-min expiry) **with content-length and content-type bound to the signature**.
4. Client PUTs the file directly to R2 (does not transit through API). On success, calls `POST /commit`.
5. API enqueues a `process-photo` job in BullMQ.

### Post-processing worker

For each photo:

1. Read original from R2 (stream).
2. Strip EXIF (privacy: GPS, device serials). Keep `DateTimeOriginal` if present (it's already in DB).
3. Generate **thumb** (480px longest edge, q72) → `thumbs/{roomId}/{photoId}.webp`.
4. Generate **medium** (1600px, q82) → `medium/{roomId}/{photoId}.webp`.
5. (Optional, Phase 2) NSFW detection via a hosted model (Sightengine or AWS Rekognition). If flagged, set `status=FLAGGED`, do not deliver.
6. Update DB: `status=READY`, store keys.
7. Emit `photo:new` via Socket.IO to `room:{roomId}`.
8. Send Expo push to other members ("3 new photos in Lola's Birthday").

### Serving photos

- All R2 objects are **private**.
- API issues short-lived signed URLs (5 min) on read.
- Long-running gallery views refresh URLs via TanStack Query stale time.
- Bulk download: worker zips into R2 under `/exports/{roomId}/{exportId}.zip`, signed URL valid 24h.

### Storage cost control

- Cloudflare R2: $0.015/GB-month, no egress fees.
- Average JPEG ~2.5 MB. 750 photos ≈ 1.9 GB → ~$0.03/month per Standard Room during retention. Cost is dominated by compute, not storage.

---

## 11. Real-time Features

### Connection lifecycle

1. Mobile connects to `wss://api.sher.app/rooms` with `auth.token = accessToken`.
2. Gateway middleware verifies JWT, attaches `user` to socket.
3. Client emits `join` with `{ roomId }`. Server checks membership, joins the Socket.IO room.
4. Heartbeat every 25s. Reconnect with backoff on drop. Tokens refreshed by HTTP refresh flow; on 401 from socket, client reconnects with new token.

### Scaling

- Redis adapter (`@socket.io/redis-adapter`) so any API pod can publish to any client.
- Sticky sessions not required with the adapter, but recommended at the load balancer for fewer reconnects.

### Events not in §6

- `upload:progress` — optional, server-relayed from uploader's other devices (low priority, Phase 2).
- `presence:update` — count of online members in a room (debounced).

---

## 12. Push Notifications

### Triggers

| Event                                                 | Audience           | Body                                                |
| ----------------------------------------------------- | ------------------ | --------------------------------------------------- |
| New photos batched (every 60s while app backgrounded) | Other room members | "5 new photos in {room name}"                       |
| Member joined                                         | Host               | "{name} joined {room name}"                         |
| Room ending soon (1h, 10 min)                         | Host               | "{room name} closes in 10 min"                      |
| Photos expiring (T-7d, T-1d)                          | All members        | "Photos from {room name} delete in 7 days. Extend?" |
| Payment success                                       | Payer              | "Payment received. {room name} is live."            |
| Payment failed                                        | Payer              | "Payment didn't go through. Try again?"             |

### Implementation

- `apps/api` writes a `notification.send` job into BullMQ.
- Worker fans out tokens, calls Expo Push API in batches of 100 (Expo's limit), records receipts.
- 24h later, a follow-up job checks receipts; removes invalid tokens (`DeviceNotRegistered`).

---

## 13. Lifecycle & Retention

### State machine for Room

```
DRAFT
  │ (instantly auto-promoted on create — Sher has no payment up front)
  ▼
ACTIVE  (capture window — all members see the gallery in real time)
  │
  │ (endsAt reached OR host taps End)
  ▼
ENDED   (paywall engages; gallery shows locked thumbnails to LOCKED members)
  │
  │ (retentionUntil reached without sufficient unlocks)
  ▼
EXPIRED  → photos purged from R2 → ARCHIVED
```

Notes:

- **The paywall engages exactly at `Room.status = ENDED`.** Before that, the gallery is fully visible to all members regardless of unlock state.
- Unlocked members can continue downloading right up to `retentionUntil`.
- LOCKED members can still pay MEMBER_UNLOCK any time before `retentionUntil` — they retroactively gain access.
- If the host never pays BASE_UNLOCK and no extras pay either, photos still purge on schedule. There is no permanent "free archive" by default.

(See §5 for the per-Membership unlock state machine — it is the other half of this lifecycle and runs independently per member.)

### Scheduled jobs (BullMQ, repeatable)

| Job                     | Schedule        | Action                                                                                                       |
| ----------------------- | --------------- | ------------------------------------------------------------------------------------------------------------ |
| `room.tick`             | every 5 min     | move ACTIVE→ENDED where `endsAt < now`                                                                       |
| `room.retention.notify` | daily 08:00 WAT | notify members at T-7d, T-1d                                                                                 |
| `room.retention.purge`  | daily 02:00 WAT | for ENDED rooms with `retentionUntil < now`: delete photos from R2, soft-delete DB rows, move room → EXPIRED |
| `payment.reconcile`     | hourly          | resolve stuck PENDING payments                                                                               |
| `auth.cleanup`          | daily           | delete expired OtpChallenge rows                                                                             |
| `device.prune`          | weekly          | remove DeviceTokens not seen in 60 days                                                                      |

### Retention extension

`POST /rooms/:id/retention/extend { months }` → payment → on success, append `RetentionWindow`, recompute `Room.retentionUntil = max(retentionUntil, originalEnd + extension)`. Cap at `originalEnd + 365 days`.

---

## 14. Security

### Threat model (top risks → mitigation)

| Threat                          | Mitigation                                                                                                                                                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Photos leaking to non-members   | Private R2 + signed URLs only; membership check on every read; never expose R2 base URL                                                                                                                                      |
| Account takeover via SIM swap   | Risk inherent to phone-OTP; mitigate with device binding (new device → email confirmation — email is always present post-signup; fallback 24h cool-down applies only if `emailVerified = false` at time of new-device login) |
| OTP brute force                 | 5 attempts per challenge, rate limit per phone + IP, exponential lockout                                                                                                                                                     |
| Stolen JWT                      | Short access TTL (15 min), refresh rotation with reuse detection, secure-store                                                                                                                                               |
| Reverse-engineered API          | Certificate pinning (mobile), per-user rate limits, app attestation (Play Integrity, App Attest) on sensitive endpoints — Phase 2                                                                                            |
| Payment tampering               | Webhook signature verification, amount + ref check, idempotency, reconciliation                                                                                                                                              |
| Malicious uploads (CSAM, abuse) | Mandatory moderation queue for flagged content; auto-scan in Phase 2; takedown SLA documented                                                                                                                                |
| EXIF metadata leaking GPS       | Strip EXIF server-side on post-process                                                                                                                                                                                       |
| DoS                             | Cloudflare WAF + rate limits; R2 absorbs upload traffic so API isn't bottleneck                                                                                                                                              |
| Data at rest                    | Postgres encryption at rest (provider default), R2 server-side encryption, secrets in Secrets Manager                                                                                                                        |
| Data in transit                 | TLS 1.3 everywhere, HSTS, no plaintext fallback                                                                                                                                                                              |
| SQL injection                   | Prisma parameterized queries (no raw SQL except reviewed migrations)                                                                                                                                                         |
| Mass assignment                 | DTOs validated with class-validator / Zod; whitelist fields                                                                                                                                                                  |
| Insecure deserialization        | No `eval`, no untrusted JSON.parse without schema                                                                                                                                                                            |
| Dependency vulns                | Dependabot + Snyk in CI; `pnpm audit` gate                                                                                                                                                                                   |

### OWASP Mobile Top 10 — concrete actions

- **M1 Improper credential usage:** never log tokens; secure-store only; no hardcoded secrets (CI scans with `gitleaks`).
- **M2 Inadequate supply chain security:** lockfiles checked in; Renovate bot for updates; review native dependency licenses.
- **M3 Insecure auth/authz:** policies enforced server-side (never trust mobile-side checks).
- **M4 Insufficient input validation:** Zod on every API input; image MIME sniffing (not just header).
- **M5 Insecure communication:** TLS pinning via `react-native-cert-pinner` for `api.sher.app`.
- **M6 Privacy controls:** in-app data export + delete (NDPR); no analytics PII without consent.
- **M7 Insufficient binary protection:** ProGuard/R8 on Android (Expo prebuild), Hermes bytecode obfuscation.
- **M8 Security misconfiguration:** disable JS debugging in release builds; no `console.log` in production (Babel strip).
- **M9 Insecure data storage:** SQLite upload queue contains no auth data; photos in app sandbox only.
- **M10 Insufficient cryptography:** rely on platform APIs (Keychain/Keystore); no custom crypto.

### Compliance — NDPR (Nigeria) + GDPR-ish posture

- Publish a **Privacy Policy** and **Terms** before launch. Cover: data categories, lawful basis (consent + contract), retention (30d default + paid extensions), processors (Cloudflare, Paystack, Termii, Expo, Sentry).
- In-app **Account & data** screen: download my data (JSON export), delete account.
- DPO contact email.
- Maintain **records of processing**.
- Data Protection Impact Assessment for photo storage (sensitive category if biometric inference is possible — note we do not perform face recognition).

---

## 15. Testing Strategy

### Pyramid

```
       /\        E2E (Maestro)              ~30 flows
      /--\       Mobile component (RNTL)    ~150 tests
     /----\      API integration (Jest+Supertest) ~250 tests
    /------\     Unit (Jest, both)          ~600+ tests
   /--------\    Static (TS, ESLint, Zod)   compile-time
```

### Coverage targets

- **API:** 80% lines, 100% on auth/payments/retention modules.
- **Mobile:** 60% lines, 100% on upload queue + auth flows.
- Mutation testing on critical paths (Stryker) — Phase 2.

### Test types and where they live

**API — `apps/api/test/`**

- Unit (`*.spec.ts`) next to source; pure functions, services with mocked deps.
- Integration (`test/integration/`): spin up Postgres + Redis via Testcontainers, hit real endpoints with Supertest, real Prisma.
- Contract: provider-side Pact tests for the mobile API client (Phase 2).
- Webhook tests: synthetic Paystack/Flutterwave payloads with correct/incorrect signatures.
- Property-based: fast-check on pricing/quota calculation.

**Mobile — `apps/mobile/__tests__/`**

- Unit: pure utilities, filter pipeline math, queue state machine.
- Component: React Native Testing Library, render screens with mocked TanStack Query + Zustand.
- Snapshot: avoid except for stable visual primitives.
- E2E: **Maestro** (preferred over Detox for maintenance), flows in `e2e/flows/*.yaml`:
  - Sign up → host room → pay (mocked) → capture photo → see it in gallery
  - Join via QR → capture → like a photo → download
  - Retention expiry path (time-warped)

**Load — `tests/load/`**

- k6 scenarios: 500 concurrent uploaders per room, 10k concurrent gallery viewers.
- Target SLOs: p95 upload-url < 200ms, p95 commit < 300ms, p95 gallery page < 400ms.

**Security**

- Static: `eslint-plugin-security`, `semgrep` rules in CI.
- Secrets: `gitleaks` pre-commit + CI.
- Dynamic: scheduled OWASP ZAP scan against staging.
- Dependency: `pnpm audit`, Snyk, Dependabot.

### Test data

- Faker for personas; seed scripts produce realistic rooms with sample photos.
- A **deterministic seed** flag for reproducible E2E runs.

### CI gates

A PR cannot merge if:

- TypeScript fails
- Any test fails
- Coverage drops below threshold
- Lint errors
- Secret detection triggers
- `pnpm audit` high/critical without exception

---

## 16. Observability

### Logging

- **Pino** structured JSON logs, request-scoped, correlation ID per request (`x-request-id` header propagated to workers via job metadata).
- Ship to **BetterStack** (or Datadog). Retain 30 days hot, 1 year cold.
- **PII rules:** never log phone numbers in full (`+234***5678`), never log tokens, never log photo bytes. Lint rule + pino-redact.

### Metrics

- Prometheus exposition at `/internal/metrics` (auth: cluster-internal only).
- RED metrics per route (rate, errors, duration), per BullMQ queue (waiting, active, failed, completed).
- Business metrics: rooms created/day, photos/room, payment success rate, retention purchase rate.
- Grafana Cloud dashboards.

### Errors

- **Sentry** for both API and mobile.
- Mobile: capture JS + native crashes (Sentry's `@sentry/react-native`), source maps uploaded by EAS in CI.
- API: filter expected exceptions (e.g., 4xx) from alerting.
- PII scrubbing on by default.

### Tracing

- OpenTelemetry SDK in NestJS, exported to Grafana Tempo (or Datadog APM). Workflows of interest: photo upload commit, payment verify, retention purge.

### Alerts

| Alert                   | Condition                                | Channel          |
| ----------------------- | ---------------------------------------- | ---------------- |
| API error rate          | 5xx > 1% over 5 min                      | Slack #incidents |
| OTP failure spike       | failures > 50/min                        | Slack            |
| Payment webhook lag     | >5 min between Paystack send and receipt | PagerDuty        |
| Worker backlog          | any queue `waiting > 1000` for 10 min    | Slack            |
| R2 4xx/5xx              | unusual rate                             | Slack            |
| Retention purge skipped | job didn't run by 03:00 WAT              | Slack            |

### Runbooks

Each alert links to a markdown runbook in `docs/runbooks/`. Sample runbooks to create: payment-stuck, otp-blackout, worker-backlog, r2-outage, db-failover.

---

## 17. Infrastructure & DevOps

### Environments

- `local` — Docker Compose (Postgres, Redis, MinIO emulating R2)
- `preview` — ephemeral per-PR for backend, Expo dev client + EAS internal distribution
- `staging` — full cloud, test Paystack keys, test SMS sender
- `production` — full cloud, live keys

### Terraform layout

```
infra/terraform/
├── modules/
│   ├── vpc/
│   ├── ecs-service/
│   ├── postgres/        # RDS or DO managed
│   ├── redis/           # ElastiCache or DO managed
│   ├── r2/              # Cloudflare provider
│   ├── secrets/
│   └── monitoring/
├── envs/
│   ├── staging/
│   └── production/
```

### Containers

- `apps/api/Dockerfile` — multi-stage Node 20 alpine, non-root, distroless final image.
- `apps/worker/Dockerfile` — same base, different entrypoint.
- Images pushed to ECR (AWS) or DOCR (DigitalOcean).
- Health checks: `/health` (liveness) and `/ready` (readiness — checks DB + Redis).

### Deployment

- **API + Worker:** blue/green on ECS Fargate (or rolling on DO App Platform). 2 API tasks min, 2 worker tasks min, autoscale on CPU.
- **Database migrations:** Prisma migrate, run as a one-off task pre-deploy; gated.
- **Zero-downtime:** drain connections via SIGTERM handling (15s grace).
- **Rollback:** automatic on failed health check; manual revert via deploy tag.

### Mobile release pipeline

- `main` branch → EAS Build → internal channel (staging) → manual promotion to production channel.
- **OTA updates** (EAS Update) for JS-only changes; full store submission only for native changes.
- Phased rollout via App Store / Play (25% → 50% → 100% over 48h).
- Crash-rate gate: if Sentry crash-free sessions drop below 99.5% during rollout, halt.

### GitHub Actions workflows

`.github/workflows/`

- `ci-api.yml` — lint, type, test, build, image push
- `ci-mobile.yml` — lint, type, test, eas build (preview channel on PR)
- `cd-api.yml` — on tag `api-v*`, deploy to ECS
- `cd-mobile.yml` — on tag `mobile-v*`, eas submit
- `nightly-security.yml` — ZAP scan, dependency audit
- `terraform-plan.yml` — on PR touching `infra/`
- `terraform-apply.yml` — manual approval after merge

### Secrets

Stored in Doppler or AWS Secrets Manager, injected at task start. Categories:

- DB URL, Redis URL
- JWT private key, public key
- Paystack secret + public key, webhook secret
- Flutterwave secret + webhook hash
- Termii API key
- Expo access token, EAS project ID
- R2 access key + secret + account id
- Sentry DSN (separate for mobile + api)

---

## 18. Cost Estimate (rough, monthly, USD, MVP scale ~ 1,000 rooms/month)

| Item                                       | Est.            |
| ------------------------------------------ | --------------- |
| 2× ECS Fargate task (API, 0.5 vCPU / 1 GB) | $25             |
| 2× ECS Fargate task (worker)               | $25             |
| Managed Postgres (db.t4g.small)            | $30             |
| Managed Redis (cache.t4g.micro)            | $15             |
| Cloudflare R2 storage (~500 GB)            | $7.50           |
| Cloudflare R2 ops                          | $5              |
| Cloudflare Pro (WAF)                       | $20             |
| Termii SMS (~10k OTPs @ ₦4 each ≈ $25)     | $25             |
| Expo EAS (Production plan, optional)       | $99             |
| Sentry (Team)                              | $26             |
| BetterStack (logs)                         | $25             |
| Domain, misc                               | $5              |
| **Total**                                  | **~$300/month** |

Scaling to 10× volume primarily increases SMS, storage, and compute roughly linearly. Egress stays $0.

---

## 19. Decisions Log

### Resolved (locked in v2.0)

| Decision          | Choice                                                                                                                                                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand name        | **Sher**                                                                                                                                                                                                                                                                                 |
| Pricing model     | Free to create; post-event paywall. Base ₦1,500 (host, covers 3) + ₦1,000 per extra member (self-paid)                                                                                                                                                                                   |
| Multi-currency    | Yes — Paystack, regional psychological pricing in NGN/USD/GHS/KES/ZAR/GBP/EUR; locked to room at creation                                                                                                                                                                                |
| Payment processor | Paystack primary, Flutterwave fallback                                                                                                                                                                                                                                                   |
| Visual identity   | Fun, full saturated colors, **no gradients**                                                                                                                                                                                                                                             |
| Email at signup   | **Required and unique.** Collected in-app after first OTP verify (non-blocking). Verified async via Resend confirmation link. `emailVerified Boolean @default(false)`. `marketingConsent Boolean @default(false)`. Transactional email always allowed; marketing email requires consent. |

### Still open (recommend pre-Phase-0 decisions)

1. **Hosting target** — AWS ECS Fargate or DigitalOcean App Platform. _Recommend: DO App Platform for MVP, migrate to AWS at scale._
2. **Video clips** — photos only at launch, or short (5–10s) clips too? _Recommend: photos only; video doubles complexity, storage cost, and processing time._
3. **Web gallery** — public/private web counterpart for non-app users? _Recommend: not in MVP._
4. **Moderation** — manual reports only at launch, or auto-scan (e.g., Sightengine) from day 1? _Recommend: manual + flag button at launch; auto-scan in Phase 2._
5. **Languages** — English only at launch? _Recommend: English-only launch but i18n scaffolding from day 1._
6. **Exact font licensing** — Cabinet Grotesk has a commercial license fee; Recoleta similar. _Recommend: confirm budget or substitute (Space Grotesk + Plus Jakarta Sans are free alternatives that fit the brief)._
7. **Currency override UX** — let users manually switch their currency in Settings, or auto-only? _Recommend: auto with a manual override available, especially for users who travel._

---

## 20. Build Plan — Claude Code Phases

Feed Claude Code **one phase at a time**. Each phase has explicit deliverables, acceptance criteria, and "definition of done." Do not move on until the previous phase passes its checks.

> Tip for prompting Claude Code: start each phase with `"Read /docs/architecture.md sections X-Y. Then execute Phase N below. Do not skip steps. Run all tests before declaring done. If a decision is ambiguous, ask me."`

### Phase 0 — Repo & Tooling

**Goal:** Empty monorepo that lints, builds, tests, and runs locally.

- Initialize pnpm + Turborepo monorepo per §4.
- Shared configs (`packages/config`): ESLint, Prettier, TS, commitlint, husky pre-commit.
- Dockerfiles + `docker-compose.yml` for Postgres 16, Redis 7, MinIO.
- GitHub Actions CI skeleton (lint, type, test on PR).
- `.env.example` for every app.
- README with local setup steps.
  **Done when:** `pnpm dev` brings up compose + API stub + mobile dev server.

### Phase 1 — Backend Foundation

**Goal:** NestJS API skeleton with DB, auth scaffolding (no OTP yet), logging, error handling.

- Scaffold `apps/api` with NestJS.
- Prisma schema (§5) committed; first migration applied; seed script.
- Global filters: `HttpExceptionFilter`, validation pipe (class-validator), response envelope interceptor.
- Logging (Pino with request-id middleware).
- Health/ready endpoints.
- Throttler module (Redis store).
- Sentry integration.
- 90%+ test coverage on filters, interceptors, prisma service.
  **Done when:** `POST /v1/health` returns 200, integration tests pass on CI, schema visible in Prisma Studio.

### Phase 2 — Phone OTP Auth

**Goal:** End-to-end auth: request → verify → issue JWT pair → refresh → revoke.

- Termii integration (with mock provider for tests/local).
- `OtpChallenge` lifecycle.
- JWT module (RS256), key rotation supported.
- Refresh rotation + reuse detection.
- Endpoints in §6 Auth block.
- DTOs + Zod validation.
- AuthGuard, RolesGuard, RoomRoleGuard (membership-based).
- Tests: happy path, rate limits, attempt lockout, refresh reuse → family revocation, expired challenge, wrong code.
  **Done when:** E2E test signs in, hits `/me`, refreshes, logs out — all green.

### Phase 3 — Mobile Foundation

**Goal:** RN app boots, navigates, can authenticate, brand system is in place.

- Scaffold `apps/mobile` with Expo + Expo Router.
- **Implement design tokens from §7.5** (`apps/mobile/theme/tokens.ts`): solid colors only, no gradient utilities, type scale, radius, spacing. Add an ESLint rule that bans `expo-linear-gradient` and `LinearGradient`.
- Base components: Button, Card, Sticker (rotated chip), JoinCodeDisplay, EmptyState — all using tokens.
- Storybook (or component playground screen) with a contrast audit page that asserts WCAG AA for every token pair.
- Auth flow screens (welcome, phone, verify) — opportunity to land the playful brand voice.
- Secure-store for tokens.
- Axios/fetch client with auth interceptor (auto refresh on 401).
- TanStack Query + Zustand setup.
- Generated API types (OpenAPI → TS via `openapi-typescript`, or hand-written zod-based client referencing `packages/shared-types`).
- Sentry RN integration.
- Maestro flow: open app → sign in → see "My Rooms" empty state.
  **Done when:** A real device can sign in against staging API and persist session across restarts; the contrast audit page passes; no gradient imports exist anywhere.

### Phase 4 — Rooms (Create, Join, Membership)

**Goal:** Hosts can create rooms for free instantly; guests can join via code/QR; memberships enforced; per-member unlock state tracked.

- Backend: room module, join code generator (Crockford base32, 6 chars, no ambiguous chars, collision-checked), QR token signer (HMAC), membership service with `joinOrder` assignment, policies.
- All Rooms endpoints in §6 except `/unlock/*` and `/retention/*` (next phase).
- Membership `unlockState` defaults to LOCKED on join. Members ≤ `baseCapacity` are flagged but not auto-EXEMPT until BASE_UNLOCK happens.
- Currency resolution at Room creation (`resolveCurrency`).
- Pricing service (`PRICE_BOOK`, `quote`, `formatDisplay`) with unit tests for every supported currency.
- Socket.IO gateway with `/rooms` namespace, member join/leave events.
- Mobile: Create flow (free, instant), Join flow (manual code + QR scan via Vision Camera), Room dashboard screen, "extra member" warning sheet when host invites a 4th+.
- E2E: host creates room (free), guest joins via QR, host invites a 4th member and sees the per-extra-member fee warning in their local currency.
  **Done when:** Two simulators join the same room, see each other in members list, and the host sees a correctly-priced per-extra warning when adding the 4th member.

### Phase 5 — Payments & Post-Event Paywall (Paystack + Flutterwave, multi-currency)

**Goal:** Real money moves at end of event; per-member unlocks are idempotent; multi-currency works.

- Backend:
  - `PaymentsModule`, `PaystackClient`, `FlutterwaveClient` implementing a shared `PaymentProvider` interface.
  - `WebhookController` with signature verification (HMAC-SHA512 for Paystack, hash compare for Flutterwave).
  - `/rooms/:id/unlock/base` (host) and `/rooms/:id/unlock/member` (extra member, self).
  - Payment row with `amountMinor` + `currency`; idempotent `providerRef` unique constraint.
  - State transitions: on verified BASE_UNLOCK → set `Room.baseUnlockedAt`, transition all `joinOrder ≤ baseCapacity` memberships to `EXEMPT`. On verified MEMBER_UNLOCK → that single membership to `UNLOCKED`.
  - Reconciliation job (hourly): resolve PENDING payments older than 30 min by calling provider verify.
  - Authorization: only host can pay BASE_UNLOCK; only the member themselves can pay their MEMBER_UNLOCK.
- Mobile:
  - End-of-event paywall sheet for host: "Unlock photos for ₦1,500" (local-currency formatted).
  - Paywall sheet for extras: "Unlock your photos for ₦1,000".
  - In-app browser checkout, deep-link return, polling/socket for unlock confirmation.
  - Provider switcher ("Try Flutterwave instead") visible after one Paystack init failure.
  - Locked-state gallery UI (thumbnails greyed, lock icons, sticker labels).
- Tests:
  - Signature verification (valid, invalid, replayed).
  - Amount + currency mismatch rejection.
  - BASE_UNLOCK from non-host rejected.
  - MEMBER_UNLOCK by user A for user B rejected.
  - Idempotency: same `providerRef` webhook twice → second is no-op.
  - Reconciliation resolves a stuck PENDING.
  - Currency resolution unit tests for all supported countries → currencies.
  - End-to-end: host ends room → pays BASE_UNLOCK with Paystack test keys → first 3 members go EXEMPT → gallery unlocks for them.
  - End-to-end: extra member pays MEMBER_UNLOCK → their access unlocks independently; other extras stay LOCKED.
    **Done when:** Both flows complete with Paystack test cards in NGN and USD; webhook idempotency verified; the four authorization checks all reject correctly.

### Phase 6 — Photo Capture & Upload

**Goal:** Members can capture, queue, and upload photos. Gallery updates live.

- Mobile: Camera screen with Vision Camera, capture writes to FileSystem queue, SQLite-backed upload queue with retry/backoff, progress UI.
- Filters (initial 8) via Skia.
- EXIF read for `takenAt`.
- Backend: presigned PUT issuance, commit endpoint, BullMQ `process-photo` worker (thumb + medium variants with sharp, EXIF strip).
- Gallery screen (FlashList, signed-URL refresh, swipe viewer).
- Socket.IO `photo:new` triggers TanStack Query invalidation.
- Tests: queue resumes after kill, retry exhausts gracefully, MIME spoof rejected, oversize rejected, plan cap enforced.
  **Done when:** Two devices capture simultaneously; both see each other's photos within seconds; killing the app mid-upload resumes on relaunch.

### Phase 7 — Engagement & Downloads

**Goal:** Likes, individual + bulk download, photo deletion.

- Backend: reactions module, photo deletion (auth: uploader or host), bulk zip job.
- Mobile: like button, single download, bulk download with progress.
- Push notifications wired through Expo (registration, sending, receipts).
  **Done when:** A user can like a friend's photo and bulk-download the whole gallery as a zip.

### Phase 8 — Lifecycle, Retention, Notifications

**Goal:** Rooms end (paywall engages), photos expire, members can extend, retroactive unlock is possible.

- BullMQ repeatables for `room.tick` (advances ACTIVE→ENDED at `endsAt`), `retention.notify`, `retention.purge`, `payment.reconcile`, `auth.cleanup`, `device.prune`.
- Retention extension flow (any unlocked member can pay → new RetentionWindow → recompute `Room.retentionUntil`, capped at 365 days post-event).
- LOCKED members can still pay MEMBER_UNLOCK retroactively any time before `retentionUntil` — verify they retroactively gain access and the gallery query returns photos for them.
- Push triggers per §12: room ending soon, photos expiring T-7d/T-1d, payment success/failure, "new photos" digest.
- Tests with time-traveled clock (`@sinonjs/fake-timers`):
  - Create room → end it → 30 days pass with no unlocks → photos purged.
  - Create room → end it → host pays BASE_UNLOCK → 15 days later extra pays MEMBER_UNLOCK → both still have access.
  - Extension by 3 months pushes purge out by 3 months.
    **Done when:** All time-warped scenarios above pass; push notifications fire at correct offsets in staging.

### Phase 9 — Security Hardening

- Certificate pinning in mobile.
- App attestation (Play Integrity + App Attest) on high-risk endpoints.
- Rate-limit tuning under load.
- ZAP baseline scan integrated into CI nightly.
- Secret scanning gates.
- PII redaction audit in logs (manual + automated test).
- NDPR pages: privacy policy, terms, data export, account deletion.
  **Done when:** External pen test checklist (OWASP MASTG) passes self-review.

### Phase 10 — Observability & Ops

- Grafana dashboards committed as JSON.
- Alert rules in code.
- Runbooks written.
- Load test passes SLOs from §15.
  **Done when:** Synthetic load of 500 concurrent uploads stays within SLOs and dashboards show meaningful data.

### Phase 11 — Release Engineering

- Production Terraform applied.
- EAS production builds submitted to both stores (TestFlight + Play Internal Testing).
- Phased rollout configuration.
- Crash-rate gate documented and dry-run.
  **Done when:** Production users can install from the stores and complete the create-pay-capture-download loop.

### Phase 12 — Polish & Pre-launch

- Empty states, error states, loading skeletons reviewed.
- Accessibility pass (labels, contrast, dynamic type).
- Copy review.
- App Store screenshots, listing copy, privacy declarations.
- Support contact + simple help-center (static).

---

## 21. Working Agreements (read before prompting Claude Code)

- **One concern per PR.** Even when prompting Claude Code, instruct it to keep diffs focused.
- **Tests written with the code, not after.** Reject any phase output that adds features without tests.
- **No `any` in TypeScript** except at clearly marked third-party boundaries with a comment.
- **No raw SQL** without a code review note explaining why Prisma isn't enough.
- **Never commit secrets.** `.env` is gitignored; only `.env.example` is committed.
- **Conventional commits** + semantic-release for changelogs.
- **Feature flags** for anything user-facing during development (LaunchDarkly free tier or a self-hosted simple table).
- **PRs require:** green CI, one reviewer, screenshot/video for UI changes.

---

## 22. Glossary (so Claude Code uses your terms consistently)

- **Room** — the event-bound photo collection. NOT "album", NOT "event" in code.
- **Member** — any user in a Room. **Host** is the creator. **Co-host** has host privileges except deletion.
- **Capture** — taking a photo via the in-app camera. (Don't say "take a photo" in code.)
- **Commit** — confirming an upload finished. (After PUT to R2.)
- **Retention** — the period after a Room ends during which photos remain available.
- **Base unlock** — the host's payment that grants gallery access to the first 3 members.
- **Member unlock** — an individual extra member's payment that grants gallery access to themselves only.
- **Exempt** — a member whose access is granted via the host's base unlock (not their own payment).
- **Locked / Unlocked** — the per-member access state after a Room ends.
- **Pricing currency** — the ISO 4217 code locked to a Room at creation; all Room-related payments use it.

---

## 23. Changelog

**v2.1 — Email required at signup**

- `User.email` changed from `String? @unique` (optional) to `String @unique` (required).
- Added `User.emailVerified Boolean @default(false)` and `User.marketingConsent Boolean @default(false)`.
- Email is collected immediately after first OTP verify (non-blocking; user proceeds into app).
- Email verification is asynchronous via Resend confirmation link (`POST /auth/email/verify`).
- Transactional emails (receipts, security) always sent; marketing emails gated on `marketingConsent`.
- Added `/auth/email/verify` and `/auth/email/resend` endpoints to §6.
- `POST /auth/otp/verify` response now includes `isNewUser: boolean`.
- `PATCH /me` now accepts `email` and `marketingConsent` fields.
- §14 SIM-swap mitigation updated: device binding now always uses email (always present post-signup).
- §19 "Email at signup" moved from open to resolved.

**v2.0 — Brand & business model finalized**

- Brand name set to **Sher**.
- Replaced pre-event "checkout to create" with **free-to-create + post-event paywall** model.
- Introduced **per-member unlock state** (`LOCKED` / `UNLOCKED` / `EXEMPT`) and `Membership.joinOrder`.
- Added **multi-currency** support (NGN, USD, GHS, KES, ZAR, GBP, EUR) with `Room.pricingCurrency` locked at creation.
- Removed `RoomPlan` enum (no more tiers); replaced with simple `baseCapacity` (default 3) + per-extra unlock fee.
- Updated `Payment` model: `amountMinor` + `currency`, added `membershipId` for `MEMBER_UNLOCK` targeting.
- Rewrote §9 Payment Integration end-to-end for the new model + multi-currency.
- Added §7.5 Brand Identity & Design System (full saturated colors, no gradients).
- Rewrote Phase 5 in §20 to match the new payment flow.
- Updated Phase 3 to require the design system + a contrast audit page.
- Updated Phase 8 to test retroactive `MEMBER_UNLOCK`.

**v1.0** — Initial architecture document covering the original "pay-up-front Plan tier" model.

_End of architecture document. Update version on every material change._
