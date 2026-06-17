# Tech Debt

- [ ] Standardise PhotoStatus source between API (Prisma generated enum) and shared-types (manual union). Both define identical string literal values, but nominally distinct types. Low priority — runtime JSON serialization works correctly.

- [ ] **TD-001 — `capturePhoto as any` in camera.tsx** (`app/(app)/rooms/[id]/camera.tsx:133`)
      `usePhotoOutput().capturePhoto` is cast `as any` because Vision Camera v5's `PhotoFile`
      type doesn't expose `saveToTemporaryFileAsync()` / `dispose()` used in the capture block.
      Lint passes because of an `eslint-disable-next-line` comment (no tooling gap — the rule IS
      enabled). Fix: verify on device whether `PhotoFile.path` (idiomatic v5) works, then replace
      the capture block and remove `as any`. Do NOT use `as never` here — that convention is
      for NestJS constructor mock injection in tests only.

- [ ] **TD-002 — two-argument `capturePhoto` in camera-test.tsx** (`app/(dev)/camera-test.tsx:51`)
      `photoOutput.capturePhoto({}, {})` passes two arguments; v5 signature takes one optional arg.
      Works at runtime because the call target is mocked in tests. Fix alongside TD-001 once the
      correct v5 capture API is confirmed on device.
