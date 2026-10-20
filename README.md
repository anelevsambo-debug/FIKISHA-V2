# FIKISHA-V2 — Google Apps-first delivery coordination

**Current status: partial code implementation. NOT deployed. NOT production-verified. NO-GO for real customer data.**

FIKISHA-V2 is intended to coordinate real deliveries for multiple companies in Botswana and Eswatini using separate company workbooks, company-specific AppSheet apps, Google Drive evidence storage, Apps Script workflows and the actual WhatsApp Business Platform when authorised.

## Implemented in this branch
- Core input validation, role helper, partial lifecycle state machine and tenant-context helper.
- Trusted actor resolver contract that checks an injected identity provider against active company membership and rejects caller-created actor objects.
- Platform registry Sheets adapter for company metadata, memberships, platform administrators and provisioning-job state, covered by fake-Sheets tests.
- Non-destructive platform workbook initializer that preserves existing records and rejects incompatible schema versions.
- Retry-safe company Drive-folder/workbook provisioning primitives that discover and validate existing marked resources after partial failure; provisioning requires a resolver-branded platform-admin actor.
- Delivery service for validated creation, guarded transitions and audit-event calls.
- Google Sheets adapter with script-lock-protected idempotency reservation, duplicate-safe create-row/event writes, and retry recovery for partial create and transition operations; workbook schema v2 includes a last-operation marker.
- Initial company workbook schema initializer and tests that preserve existing data.
- Outbound Meta WhatsApp Cloud API template adapter (tested with a fake HTTP client only).
- Fail-closed Apps Script placeholder endpoints with regression tests.
- CI using checkout/setup-node v7, Node.js 24, npm ci, tests and a legacy blockchain-term scan.
- Engineering anti-loop protocol, stable remediation register and architecture/data-model/tenancy/WhatsApp/cost/privacy/operations/launch-gate documents.

## Not implemented or live-verified
- No authenticated operational API or real trusted identity provider/live platform workbook is connected. The actor resolver and membership adapter are tested contracts/adapters, not proof of end-to-end authentication. The public POST entrypoint remains disabled and returns WEBHOOK_NOT_CONFIGURED.
- No real platform/company workbook, Drive folder or AppSheet app has been created or verified. Provisioning code is not live-tested.
- No live WhatsApp credentials or messages have been configured.
- Inbound webhook signature verification, consent/opt-out processing, message status, retry/dead-letter handling, end-to-end company onboarding, AppSheet actions, backups and live two-company isolation tests remain incomplete.
- Create and transition recovery have only been tested using Node.js fakes; actual Apps Script locking and concurrent Google Sheets behavior remain unverified.
- Google Sheets does not provide a transaction across delivery, event and idempotency writes. These writes remain separate, although create/transition retries now use idempotency records and recovery markers.

The code is an implementation step, not a finished product. Do not deploy it for real deliveries or customer personal data. Review [Go/No-Go](docs/GO_NO_GO.md), [Tenancy](docs/TENANCY.md), [Deployment](docs/DEPLOYMENT.md) and [Owner Quickstart](docs/OWNER_QUICKSTART.md).
