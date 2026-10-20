# Architecture and current implementation

## Intended components
- AppSheet: authenticated operator and driver interfaces.
- Apps Script: business rules, authorization, provider integration and jobs.
- Company-specific Sheets: initial operational persistence.
- Drive: controlled proof-of-delivery evidence.
- Meta WhatsApp Cloud API: intended real messaging provider.
- GitHub Actions: automated repository checks.

## Implemented in this branch
- Core validation and permission helpers, partial state machine and tenant-context helper.
- Delivery service for validated creation, company-scoped idempotency, guarded transitions and audit-event calls.
- Google Sheets adapter with required-header checks, optimistic version checks, script-lock-protected idempotency reservation, duplicate-safe create-row/event writes, and retry recovery for partial create operations.
- Idempotent company workbook schema initializer.
- Drive folder/workbook provisioning primitives (not end-to-end verified).
- Outbound Meta template-message adapter with injected HTTP client.
- Node.js unit tests and GitHub Actions checks.

## Important boundaries and gaps
- The service is not wired to an authenticated operational entrypoint; `src/Code.js` remains fail-closed. The GET status reports `not_configured`; POST returns `WEBHOOK_NOT_CONFIGURED`.
- Service-level role/company checks validate an actor object but do not authenticate its origin. No public operation may trust a client-supplied actor, role or company ID.
- Company onboarding, trusted membership resolution, inbound webhook verification, complete AppSheet apps, live Google runtime verification, backups and deployment are not complete.
- Create-operation idempotency now has a reservation and retry-recovery path, but it has only been tested with Node.js fakes. It has not been verified against real Apps Script locks or concurrent Google Sheets writes.
- Google Sheets still cannot provide a transaction spanning a delivery, event and idempotency record. Transition updates and audit-event appends remain separate operations.
- No live Google workbook, Drive folder, AppSheet app or WhatsApp message has been created or verified.

This is not a launch-ready application. Do not use real customer data or deploy for real delivery operations.
