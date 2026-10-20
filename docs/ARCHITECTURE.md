# Architecture and current implementation

Intended components:
- AppSheet: authenticated operator and driver interfaces.
- Apps Script: business rules, authorization, provider integration and jobs.
- Company-specific Sheets: initial operational persistence.
- Drive: controlled proof-of-delivery evidence.
- Meta WhatsApp Cloud API: intended real messaging provider.
- GitHub Actions: automated repository checks.

Implemented in this branch: core validation and permission helpers, a partial state machine, tenant context, delivery service, Sheets adapter, outbound Meta template-message adapter, and initial unit tests.

Important gaps: the service is not wired to an authenticated HTTP endpoint; Code.js remains a placeholder. Company onboarding, authenticated membership resolution, inbound webhook verification, complete AppSheet apps, atomic idempotency, retries, backups, live isolation tests, and deployment are not complete. This is not a launch-ready application.
