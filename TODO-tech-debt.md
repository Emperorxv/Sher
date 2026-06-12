# Tech Debt

- [ ] Standardise PhotoStatus source between API (Prisma generated enum) and shared-types (manual union). Both define identical string literal values, but nominally distinct types. Low priority — runtime JSON serialization works correctly.
