# Remediation Register

**Branch:** `build/v2-complete`  
**PR:** #1 (draft; do not merge)  
**Baseline reviewed:** `12bfb735cc48a954508a1044b5747b737c6a814a`  
**Control protocol:** [ENGINEERING_CONTROL.md](ENGINEERING_CONTROL.md)  
**Overall status:** NO-GO for real customer operations. Safe repository engineering may continue.

## Findings

| Stable ID | Priority | Finding | Audit reconciliation | Status | Closure evidence required |
|---|---|---|---|---|---|
| FVK-01 | Critical | No authenticated operational entrypoint or trusted actor resolution; `src/Code.js` is a placeholder. | CONFIRMED | IN PROGRESS | Trusted identity boundary, server-side membership checks, deny-by-default tests, Apps Script/runtime verification. |
| FVK-02 | Critical | Tenant isolation is helper-level, not proven end-to-end. | PARTIALLY CONFIRMED | BLOCKED for live verification | Cross-company positive/negative tests through every sensitive operation, then separate test workbooks/accounts. |
| FVK-03 | High | Delivery, event and idempotency writes are separate; concurrent duplicate create/transition and partial failure recovery are not guaranteed. | CONFIRMED | NOT STARTED | Race/duplicate tests, bounded lock or reservation design, durable recovery/journal tests, adapter and integration evidence. |
| FVK-04 | High | Consent can be represented by a supplied status; provenance and end-to-end opt-out enforcement are missing. | CONFIRMED | NOT STARTED | Server-controlled consent provenance, opt-out suppression, audit evidence and tests across every message path. |
| FVK-05 | High | Driver offer lifecycle is incomplete; accepting a role/action is not tied to a persisted outstanding offer. | PARTIALLY CONFIRMED | NOT STARTED | Persisted offer state, driver/company binding, expiry/reoffer handling and replay/concurrency tests. |
| FVK-06 | High | Secure inbound webhook authenticity and replay protection are not implemented. | CONFIRMED | BLOCKED on secure ingress design/runtime proof | Signature verification at a trusted ingress, timestamp/event replay protection, invalid-signature tests, no live enablement until verified. |
| FVK-07 | High | Google Sheets does not make multi-record delivery/event/idempotency writes transactional. | CONFIRMED | IN PROGRESS as a design constraint | Explicit consistency model, operation journal/recovery, failure-injection tests and documentation matching actual behaviour. |
| FVK-08 | High | Provisioning can leave partial Drive/workbook resources after failure. | CONFIRMED | NOT STARTED | Stable operation ID, retry-safe resource discovery, partial-failure cleanup/resume and adapter tests. |
| FVK-09 | High | Proof-of-delivery enrollment/verification path is incomplete. | PARTIALLY CONFIRMED | NOT STARTED | Authorized evidence capture/verification, company/delivery binding, negative tests, audit trail. |
| FVK-10 | Medium | `doGet` reports `configured` while the operational API is absent. | CONFIRMED | IN PROGRESS | Readiness response is truthful and covered by regression tests; remains explicitly not ready. |
| FVK-11 | High | Actual AppSheet app, data source permissions and role-specific access are unverified. | UNVERIFIABLE WITH CURRENT ACCESS | BLOCKED | Owner-authorized test environment and direct configuration/access evidence. |
| FVK-12 | Medium | CI uses Node.js 20 and does not establish Apps Script runtime compatibility; Actions has announced Node 20 deprecation. | CONFIRMED | NOT STARTED | CI runtime compatibility reviewed, dependency/action warnings addressed safely, Apps Script-compatible tests or test harness. |
| FVK-13 | High | No backup restoration exercise is evidenced. | CONFIRMED (absence of evidence) | BLOCKED on test workspace/access | Documented backup, restore drill, measured recovery evidence and owner approval before live use. |
| FVK-14 | High | Privacy/legal and retention readiness has not been verified for the intended operating jurisdictions. | UNVERIFIABLE WITH CURRENT ACCESS | BLOCKED on policy/owner review | Data inventory, retention/erasure process, provider terms, jurisdiction-specific review and owner sign-off. |

## Additional findings

| Stable ID | Priority | Finding | Status | Closure evidence required |
|---|---|---|---|---|
| FVK-15 | High | Existing workbook schema initializer may create some missing sheets before discovering a later mismatch; retry can resume only if all created structures remain compatible. This is a partial side effect, not a data-clearing defect. | IMPLEMENTED, NOT VERIFIED | Fake Apps Script spreadsheet tests for empty, already initialized, partial initialization, schema mismatch and company-config mismatch; then Apps Script runtime verification. |
| FVK-16 | High | Delivery creation checks an actor object supplied to the service but does not establish that the object came from a trusted identity provider. | CONFIRMED; overlaps FVK-01 | The only public operation must resolve authenticated identity server-side; direct caller-supplied actor/company values cannot authorize operations. |
| FVK-17 | Medium | Current CI's existing successful run tests Node.js logic, not actual Apps Script or Google/Meta services. | CONFIRMED | Keep evidence labels explicit and add runtime/adapter tests without representing them as live-service proof. |

## First implementation batch

| Task ID | Finding | Root cause | Chosen action | Acceptance criteria | Status / evidence |
|---|---|---|---|---|---|
| FVK-DOC-01 | All | No permanent repo-level anti-loop register existed at the reviewed branch baseline. | Add engineering control protocol and stable register before feature work. | Rules, stable IDs, statuses, acceptance evidence and launch boundary are committed to the working branch. | IMPLEMENTED; commit `bbfbf72376cfa5b20a933a5e886a842e936dfaa1` added `docs/ENGINEERING_CONTROL.md`. Register creation follows in a separate commit. |
| FVK-10-FIX-01 | FVK-10 | Status endpoint labels a placeholder as configured. | Return an explicit non-ready status and test both GET and POST fail-closed responses; do not add an unauthenticated operational API. | GET cannot imply operational readiness; POST continues to refuse processing; tests execute the actual `Code.js` handlers in a controlled VM. | IN PROGRESS; implementation and CI evidence pending. |
| FVK-01-DESIGN-01 | FVK-01/FVK-16 | Apps Script entrypoint has no trusted actor-resolution boundary. | Keep business operations disabled until identity/membership resolution is established. Next: design/test an explicit trusted actor resolver contract and ensure no client-supplied identity is accepted as proof. | Unauthenticated, inactive, missing-membership and cross-tenant requests deny by default; no live endpoint is enabled. | NOT STARTED; no owner action required for the initial design/tests. |

## Decision / access blockers

- **Live Google Workspace / Apps Script / AppSheet:** no authorized live test environment or configuration evidence available in repository access. Do not deploy.
- **Meta WhatsApp:** no live credentials or approved recipient/test number available. Do not send messages or enable live messaging.
- **Cross-company live isolation / backup restore:** requires an owner-authorized isolated test workspace and separate test identities.
- **Privacy/legal approval:** requires policy/owner review; do not treat a code test as legal sign-off.

## Update protocol

Append new evidence with commit SHA and workflow URL. Do not delete historical rows when status changes; record the new status and evidence in a dated update section. Do not mark a finding closed solely because related code exists.
