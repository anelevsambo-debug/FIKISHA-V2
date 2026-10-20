# FIKISHA-V2 — Google Apps-first delivery coordination

**Current status: partial code implementation. NOT deployed. NOT production-verified. NO-GO for real customer data.**

FIKISHA-V2 is intended to coordinate real deliveries for multiple companies in Botswana and Eswatini using separate company workbooks, company-specific AppSheet apps, Google Drive evidence storage, Apps Script workflows and the actual WhatsApp Business Platform when authorised.

## Implemented in this branch
- Core input validation, role helper, partial lifecycle state machine and tenant-context helper.
- Delivery service for validated creation, company-scoped idempotency reservation/recovery, guarded transitions and audit-event calls.
- Google Sheets adapter with schema checks, optimistic version checks, lock-protected create reservation, and duplicate-safe delivery/event writes.
- Initial company workbook schema initializer and tests that preserve existing data.
- Outbound Meta WhatsApp Cloud API template adapter (tested with a fake HTTP client only).
- Fail-closed Apps Script placeholder endpoints with regression tests.
- GitHub Actions tests using Node.js 24, plus a legacy blockchain-term scan.
- Engineering anti-loop protocol, stable remediation register and architecture/data model/tenancy/WhatsApp/cost/privacy/operations/launch-gate documents.

## Not implemented or live-verified
- No authenticated operational API or trusted server-side actor/membership resolution. The public POST entrypoint remains disabled and returns WEBHOOK_NOT_CONFIGURED.
- No Google workbook, Drive folder or AppSheet app has been created or verified.
- No live WhatsApp credentials or messages have been configured.
- Inbound webhook signature verification, consent/opt-out processing, message status, retry/dead-letter handling, complete company provisioning, AppSheet actions, backups and live two-company isolation tests remain incomplete.
- Create-operation recovery has only been tested using Node.js fakes; actual Apps Script locking and concurrent Google Sheets behavior remain unverified.
- Google Sheets does not provide a transaction across delivery, event and idempotency writes. Transition updates and their audit-event writes remain separate.

The code is an implementation step, not a finished product. Do not deploy it for real deliveries or customer personal data. Review [Go/No-Go](docs/GO_NO_GO.md), [Tenancy](docs/TENANCY.md), [Deployment](docs/DEPLOYMENT.md) and [Owner Quickstart](docs/OWNER_QUICKSTART.md).
