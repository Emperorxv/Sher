# Sher — Manual Verification Backlog

Items that require a real device or webcam-enabled simulator to verify.
Each entry records what was deferred, why, and the prerequisite environment.

---

## Phase 6 commit 8 — camera capture + upload pipeline (pending real device)

Verified on simulator (commit c5ddda2, CI green):

- ✓ "Take photo" button visible only when room ACTIVE + caller UNLOCKED/EXEMPT
- ✓ Tap → camera screen opens
- ✓ Permission-denied view renders correctly
- ✓ Camera-unavailable view renders gracefully (no crash)
- ✓ Close button returns to room dashboard

Deferred — requires physical device or webcam-enabled simulator:

- ✗ Actual photo capture (Vision Camera native module active, not mocked)
- ✗ Upload pipeline execution against R2 (getUploadUrl → PUT → commit)
- ✗ Photo row written to DB + photoCount increments on room dashboard
- ✗ Optimistic UI tile appears during upload with spinner
- ✗ Upload completes → tile auto-clears after 2 s
- ✗ Network failure → error tile + retry button
- ✗ Retry succeeds → tile clears

Prerequisite: either a physical iOS/Android device attached to Xcode/ADB, or a
macOS simulator with "Use Camera" (webcam passthrough) enabled under Features menu.
Also requires a running API + R2 instance (docker compose up -d + pnpm dev).
