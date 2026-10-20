# FIKISHA-V2 — Google Apps-first delivery coordination

**Current status: partial code implementation. NOT deployed. NOT production-verified. NO-GO for real customer data.**

FIKISHA-V2 is intended to coordinate real deliveries for multiple companies in Botswana and Eswatini using separate company workbooks, company-specific AppSheet apps, Google Drive evidence storage, Apps Script workflows and an actual WhatsApp Business provider.

## Implemented in this branch
- Core input validation, role helper, partial lifecycle state machine and tenant-context helper.
- Delivery service for validated create requests, company-scoped idempotency lookup, guarded transitions and audit-event calls.
- Google Sheets adapter with schema checks and optimistic version checks.
- Outbound Meta WhatsApp Cloud API template adapter.
- Initial unit tests and GitHub Actions checks.
- Architecture, data model, tenancy, WhatsApp, costs, privacy, deployment and launch-gate documentation.

## Not implemented or live-verified
- The Apps Script doPost endpoint remains a placeholder and is not a usable authenticated API.
- No Google workbook, Drive folder or AppSheet app has been created or verified.
- No live WhatsApp credentials or messages have been configured.
- Inbound webhook signature verification, consent/opt-out processing, retry queue, full company provisioning, authenticated membership resolution, AppSheet actions, backups and real two-company isolation tests remain incomplete.
- Google Sheets writes are not transactional; the current idempotency design is not safe against every concurrent race.

The code is an implementation step, not a finished product. Do not deploy it for real deliveries or customer personal data. Review [Go/No-Go](docs/GO_NO_GO.md), [Tenancy](docs/TENANCY.md), [Deployment](docs/DEPLOYMENT.md) and [Owner Quickstart](docs/OWNER_QUICKSTART.md).
