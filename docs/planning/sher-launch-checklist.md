# Sher Launch Checklist

Last updated: 21 June 2026
Status: Draft for review

Legend: 🔴 Blocking (can't launch without it) · 🟡 Important (strongly recommended) · 🟢 Nice to have (can follow post-launch)

---

## 1. Legal & Compliance

- [ ] 🔴 **Privacy Policy** — published, publicly accessible URL. _(Done — hosted on GitHub, pending your review of placeholders.)_
- [ ] 🔴 **Terms of Service** — not yet drafted. Needed for App Store/Play Store submission and to set usage rules (acceptable use, payment terms, liability limits, dispute resolution, account termination rights).
- [ ] 🔴 **Confirm Surf Pager Ltd is properly registered** — CAC registration number, tax ID (TIN), verify the legal entity details in the privacy policy are accurate.
- [ ] 🔴 **Account deletion flow** — Privacy Policy promises deletion "within 30 days." Currently Sher has no self-service deletion. Either build a basic in-app "Delete my account" flow, or set up a documented manual process (someone emails contact@surfpager.com, you manually delete via SQL/admin tool within 30 days).
- [ ] 🟡 **Data access request process** — a documented internal process for when someone emails asking "what data do you have on me." Doesn't need to be automated at MVP scale, just needs to exist and be followable.
- [ ] 🟡 **NDPR/NDPA compliance review** — since you're Nigeria-based, worth a lawyer's review of the Privacy Policy + ToS against the Nigeria Data Protection Act 2023, especially the child safety sections.
- [ ] 🟡 **Content moderation policy** — a public-facing document (or section within ToS) describing what content is prohibited and how reports are handled. You've referenced a "Report" feature in the Privacy Policy — confirm it exists or plan to build it.
- [ ] 🟢 **Cookie policy** — only needed if/when you build a marketing website with cookies. Not needed for the mobile app alone.
- [ ] 🟢 **DPA (Data Processing Agreements) with vendors** — confirm Cloudflare, Paystack, Flutterwave, Termii, Sentry all have standard DPAs in place (most SaaS vendors have these publicly available; usually just need to accept them).

---

## 2. Content Safety & Child Protection

- [ ] 🔴 **Age gate at sign-up** — a checkbox or screen confirming "I am 13 or older" (per Privacy Policy §5.1). Currently not implemented — Sher's OTP sign-up flow doesn't ask age.
- [ ] 🔴 **Report feature** — users need a way to report a photo or a member. Privacy Policy §5.5 promises this exists. Needs to be built if it doesn't.
- [ ] 🔴 **Report handling process** — who reviews reports, what's the SLA (Privacy Policy says 24 hours for child safety reports), what actions can be taken (remove photo, ban user, suspend room).
- [ ] 🟡 **Blocklist / block-user feature** — lets a user block another member from a room. Common baseline expectation for any app with user-generated content and social interaction.
- [ ] 🟡 **Automated content moderation** — even a basic image classifier (e.g., AWS Rekognition, Google Cloud Vision, or a simpler third-party moderation API) to flag potentially inappropriate photos before/after upload. Not required for MVP but strongly recommended given Sher handles event photos which could include minors.
- [ ] 🟢 **Manual moderation queue / admin dashboard** — a simple internal tool to review reported content. Can be a basic SQL query + spreadsheet at MVP scale.

---

## 3. Production Infrastructure

- [ ] 🔴 **Production API hosting decided and set up** — where does NestJS run in production? Options: Railway, Render, Fly.io, DigitalOcean App Platform, AWS. Pick one, provision it.
- [ ] 🔴 **Production Postgres database** — separate from your dev DB. Managed Postgres (Railway/Render/Supabase/AWS RDS) recommended over self-hosted for reliability.
- [ ] 🔴 **Production Redis instance** — for BullMQ (retention purge, photo processing jobs). Managed Redis (Upstash, Railway, Redis Cloud).
- [ ] 🔴 **Production R2 bucket** — separate from dev bucket. Confirm CORS configuration for mobile uploads.
- [ ] 🔴 **Production domain + SSL** — e.g., `api.sher.app` or similar. Needed for stable webhook URLs (no more ngrok).
- [ ] 🔴 **Production Paystack/Flutterwave webhook URLs configured** — point at the production domain, not ngrok. Test end-to-end before launch.
- [ ] 🔴 **Environment variables audit** — confirm every `.env` value has a production equivalent (JWT keys, R2 credentials, Paystack/Flutterwave live keys — not test keys, Termii production credentials).
- [ ] 🔴 **Switch Paystack/Flutterwave from test mode to live mode** — requires completing their business verification (KYC) processes, which can take days. Start this early.
- [ ] 🟡 **Database backups configured** — automated daily backups on the production Postgres instance.
- [ ] 🟡 **Sentry set up for production** — error tracking configured with production DSN, alerting rules (e.g., Slack/email on new error types).
- [ ] 🟡 **Basic uptime monitoring** — e.g., UptimeRobot, Better Uptime, or built into your hosting provider. Alerts you if the API goes down.
- [ ] 🟡 **Rate limiting on public endpoints** — especially OTP request endpoint (prevent SMS-bombing abuse) and photo upload endpoints.
- [ ] 🟢 **CDN / caching strategy for R2** — Cloudflare R2 with Cloudflare CDN in front for faster photo delivery globally.
- [ ] 🟢 **Staging environment** — a separate environment mirroring production for pre-release testing. Can defer if budget-constrained at MVP.

---

## 4. App Store / Play Store Submission

- [ ] 🔴 **Apple Developer Program enrollment** — $99/year. Required for App Store submission and for EAS Build real-device testing.
- [ ] 🔴 **Google Play Developer account** — $25 one-time, if launching on Android too.
- [ ] 🔴 **App icon (final version)** — currently likely using Expo's default placeholder icon.
- [ ] 🔴 **Splash screen (final version)**.
- [ ] 🔴 **App Store screenshots** — required sizes for each device class you support (iPhone 6.9", 6.5", iPad if applicable).
- [ ] 🔴 **App Store description, keywords, category** — marketing copy.
- [ ] 🔴 **Privacy "nutrition label" (App Store)** — Apple requires you to declare what data types you collect (matches your Privacy Policy — phone number, photos, payment info, usage data).
- [ ] 🔴 **Age rating questionnaire** — Apple/Google ask about content types (user-generated content, payments, etc.) to assign an age rating.
- [ ] 🔴 **In-app purchase / payment compliance review** — since Sher uses Paystack/Flutterwave directly (not Apple/Google IAP) for unlocking galleries, confirm this is compliant with App Store guidelines. Apple has specific rules about "physical goods/services" vs digital goods — event photo unlocks may qualify as a service exempt from Apple's 30% IAP cut, but this needs verification against Apple's current guidelines, as this is a common area of App Store rejection.
- [ ] 🟡 **TestFlight beta round** — internal testing with a small group before public release.
- [ ] 🟡 **App Store "What's New" / release notes template** — for future updates.
- [ ] 🟢 **Android build tested** — if launching iOS-only first, this can be deferred, but confirm your intent (Sher's `androidManifest` config already exists from Phase 6).

---

## 5. Product Completeness (Native-Camera-Only Scope)

- [ ] 🔴 **Real-device verification of full camera → upload → gallery flow** — deferred from Phase 6 (no Mac webcam piping available). Needs an actual iPhone. This is the single most important pre-launch technical verification.
- [ ] 🔴 **Payment flow verified live (real Paystack/Flutterwave, real bank/card)** — a full real-money test transaction before launch, using live (not test) API keys.
- [ ] 🔴 **Refund process defined** — what happens if a user disputes a charge? At minimum, a documented manual process.
- [ ] 🟡 **Onboarding flow polish** — first-time user experience: sign up → create/join first room → understand the unlock model.
- [ ] 🟡 **Empty states reviewed** — no rooms yet, no photos yet, no members yet — all should look intentional, not broken.
- [ ] 🟡 **Error states reviewed** — network failures, expired sessions, payment failures — all should have clear, non-technical user-facing messages (mostly done via the error-mapping work in Phase 5/6).
- [ ] 🟢 **Push notifications** — "new photo added," "payment confirmed" — currently relies on socket updates only (requires app open). Post-launch enhancement.
- [ ] 🟢 **Video support** — currently photos only. Post-launch if there's demand.

---

## 6. Pre-Launch Testing

- [ ] 🔴 **Full manual QA pass on a real device** — walk through: sign up → create room → invite via QR → join as guest → take photos (multiple) → end room → host pays to unlock → guests see gallery → extra member self-pays → view photo detail → room expires after retention period (or simulate via SQL).
- [ ] 🔴 **Load test the API** — even a basic test (e.g., 50 concurrent users) to catch obvious bottlenecks before real users hit it.
- [ ] 🟡 **Security review** — check for the basics: SQL injection (Prisma protects against this by default), auth token expiry/rotation working correctly, presigned URLs actually expiring, no secrets committed to git.
- [ ] 🟡 **Test on multiple real device models** — at least one older iPhone (e.g., iPhone 12/13) and one newer one, to catch performance issues.
- [ ] 🟢 **Accessibility pass** — VoiceOver support, text scaling, color contrast (especially given the brand's cyan/dark palette).

---

## 7. Business Operations

- [ ] 🔴 **Support channel** — how do users reach you when something goes wrong? At minimum, an email inbox you monitor (contact@surfpager.com already exists).
- [ ] 🟡 **Pricing confirmed final** — ₦1,500 base unlock / ₦1,000 extra member unlock (per Phase 5) — confirm these are still the intended launch prices.
- [ ] 🟡 **Business bank account connected to Paystack/Flutterwave** — for actually receiving payouts.
- [ ] 🟡 **Basic analytics** — even simple usage tracking (rooms created, photos taken, payments completed) to understand adoption post-launch. Doesn't need to be sophisticated at MVP.
- [ ] 🟢 **Marketing site / landing page** — separate from the app, for pre-launch signups or general information. Optional depending on your go-to-market plan.

---

## Suggested Sequencing

Given the 🔴 items above, here's a rough order of operations:

### Phase A — Foundational (can start now, in parallel)

1. Draft Terms of Service.
2. Build account deletion flow (or document manual process).
3. Build report feature + age gate at sign-up.
4. Start Paystack/Flutterwave live-mode KYC verification (this often has the longest lead time — start early).

### Phase B — Infrastructure

5. Decide and provision production hosting (API, Postgres, Redis, R2).
6. Set up production domain + SSL.
7. Migrate environment variables to production, confirm webhook URLs work live.
8. Set up Sentry + uptime monitoring.

### Phase C — Real-Device Verification

9. Apple Developer Program enrollment.
10. EAS Build setup.
11. Full manual QA pass on real device (camera, payments, gallery, end-to-end).
12. Fix any real-device bugs surfaced.

### Phase D — Store Submission Prep

13. App icon, splash screen, screenshots, descriptions.
14. Privacy nutrition label, age rating questionnaire.
15. In-app purchase compliance review (important — flag early with Apple's guidelines).
16. TestFlight beta round with a small group.

### Phase E — Launch

17. Submit to App Store (allow 1-3 days for review, sometimes longer for first submission).
18. Final smoke test on approved build.
19. Launch.

---

## Notes

- This checklist assumes iOS-first launch (matches your current dev focus). Android items are marked 🟢 unless you're launching both simultaneously.
- AR filters (Snap Camera Kit) are intentionally excluded — deferred per your decision to ship native-camera-only.
- Item priorities (🔴🟡🟢) are my judgment based on legal/safety necessity and App Store requirements — happy to adjust based on your risk tolerance and timeline.
- The single longest lead-time item is likely **Paystack/Flutterwave live-mode KYC verification** — worth starting immediately regardless of what else you're doing.
