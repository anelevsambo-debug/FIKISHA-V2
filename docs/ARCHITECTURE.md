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
- Trusted actor resolver contract that mints frozen, branded actor objects only after the injected identity provider and membership store return a matching active company membership.
- Platform registry Sheets adapter for Companies, CompanyMembers, PlatformAdmins and ProvisioningJobs, with header checks, duplicate-record denial and retry-safe provisioning-job upserts.
- Non-destructive platform workbook initializer with schema-version checks.
- Delivery service now rejects caller-created actor objects and requires a trusted actor resolver.
- Google Sheets adapter with required-header checks, optimistic version checks, script-lock-protected idempotency reservation, duplicate-safe create-row/event writes, and retry recovery for partial create operations.
- Idempotent company workbook schema initializer.
- Drive folder/workbook provisioning primitives that recover uniquely marked existing resources and fail closed on duplicates or identity mismatches; the provisioner requires a resolver-branded platform-admin actor (not end-to-end verified).
- Outbound Meta template-message adapter with injected HTTP client.
- Node.js unit tests and GitHub Actions checks.

## Important boundaries and gaps
- The actor resolver is a security contract, not an end-to-end authentication integration. Its injected identity provider must read a trusted authentication boundary; no real provider or platform membership-store adapter is wired yet.
- The service is not wired to an authenticated operational entrypoint; `src/Code.js` remains fail-closed. GET reports `not_configured`; POST returns `WEBHOOK_NOT_CONFIGURED`.
- The platform registry and membership adapter are not connected to a live platform workbook or a trusted identity provider. Company onboarding has retry-safe resource discovery primitives, but no live resources or AppSheet apps have been created. Inbound webhook verification, complete AppSheet apps, live Google runtime verification, backups and deployment are not complete.
- Create-operation idempotency has a reservation and retry-recovery path, but it has only been tested with Node.js fakes. It has not been verified against real Apps Script locks or concurrent Google Sheets writes.
- Google Sheets still cannot provide a transaction spanning a delivery, event and idempotency record. Create and transition paths now use recovery markers and idempotency records, but writes remain separate and actual Apps Script concurrency behavior is unverified.
- No live Google workbook, Drive folder, AppSheet app or WhatsApp message has been created or verified.

This is not a launch-ready application. Do not use real customer data or deploy for real delivery operations.

## P0-01 identity boundary decision — 2026-10-20

### Current request-to-actor path

There is currently **no authenticated operational request-to-actor path**. The Apps Script entrypoints in `src/Code.js` deliberately return non-operational responses. Internal services accept actor objects only when the injected `createTrustedActorResolver` instance has branded them in its private `WeakSet`. Company actors are minted only after a trusted identity provider supplies an email and the platform registry returns one unique active membership matching that email and requested company. Platform administrators are resolved separately from the `PlatformAdmins` registry; company membership alone does not grant platform administration.

### Trusted identity provider is not selected or connected

Do not assume `Session.getEffectiveUser().getEmail()` identifies the caller of an Apps Script web app: for a web app deployed to execute as its owner, it identifies the owner/executing account rather than reliably proving the end-user. `Session.getActiveUser().getEmail()` may be blank depending on deployment and account/security context. An email passed in request parameters, JSON, an AppSheet expression, or a caller-created actor object is not independently trusted merely because it looks valid.

Before choosing a provider, verify the exact invocation mode in an authorized non-production Google environment. If the selected AppSheet-to-Apps-Script path cannot establish caller identity independently of caller-controlled data, it must not be used as the authentication boundary. Use a supported authenticated Google invocation model or a separately verifiable signed ingress design only after its identity claims, signing key custody, replay protection and authorization semantics are specified and tested. Do not invent or infer a provider in code.

### Fail-closed behavior

The resolver now converts unexpected identity-provider failures to `IDENTITY_PROVIDER_FAILURE` and unexpected registry failures to `IDENTITY_REGISTRY_UNAVAILABLE` without copying exception messages into outward-facing errors. Existing explicit domain error codes, such as duplicate registry records, remain available for controlled handling. Missing identity, missing membership, inactive membership, invalid roles and cross-company mismatches are denied.

`doPost` remains disabled and returns `WEBHOOK_NOT_CONFIGURED`. `doGet` remains a non-operational status response. These handlers must not be connected to protected operations until the real identity source, authenticated invocation path and live Google authorization tests are evidenced in the remediation register.
