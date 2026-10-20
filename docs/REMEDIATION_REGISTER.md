# Remediation Register

**Project:** FIKISHA-V2  
**Working branch:** `build/v2-complete`  
**PR:** [#1 — draft, unmerged](https://github.com/anelevsambo-debug/FIKISHA-V2/pull/1)  
**Reviewed baseline:** `12bfb735cc48a954508a1044b5747b737c6a814a`  
**Control protocol:** [ENGINEERING_CONTROL.md](ENGINEERING_CONTROL.md)  
**Overall launch status:** NO-GO for real customer operations. Safe repository engineering may continue.

## Stable findings and audit reconciliation

| ID | Priority | Finding | Reconciliation | Status | Evidence required to close |
|---|---|---|---|---|---|
| FVK-01 | Critical | No authenticated operational entrypoint or trusted actor resolution; `src/Code.js` is a placeholder. | CONFIRMED | IN PROGRESS | Trusted identity boundary, server-side membership checks, deny-by-default tests, Apps Script/runtime verification. |
| FVK-02 | Critical | Tenant isolation is helper-level, not end-to-end verified. | PARTIALLY CONFIRMED | BLOCKED for live verification | Cross-company positive/negative tests through sensitive operations and separate test workbooks/accounts. |
| FVK-03 | High | Delivery/event/idempotency writes are separate; concurrent duplicate requests and partial failures are not fully recovered. | CONFIRMED | NOT STARTED | Race/duplicate tests, bounded reservation/locking, durable recovery tests and adapter evidence. |
| FVK-04 | High | Consent status can be supplied by a request; provenance and opt-out enforcement are missing end-to-end. | CONFIRMED | NOT STARTED | Trusted consent provenance, opt-out suppression, audit evidence and tests across every messaging path. |
| FVK-05 | High | Driver offers are not fully persisted/linked to acceptance, expiry and reoffer state. | PARTIALLY CONFIRMED | NOT STARTED | Persisted offer lifecycle, driver/company binding, expiry/reoffer and replay/concurrency tests. |
| FVK-06 | High | Inbound webhook authenticity and replay protection are not implemented. | CONFIRMED | BLOCKED on secure ingress design/runtime proof | Trusted signature-verifying ingress, replay protection and invalid-signature tests; do not enable live processing until verified. |
| FVK-07 | High | Google Sheets cannot make the current multi-record writes transactional. | CONFIRMED | IN PROGRESS as a design constraint | Explicit consistency model, operation journal/recovery, failure-injection tests, accurate docs. |
| FVK-08 | High | Provisioning may leave partial Drive/workbook resources after failure. | CONFIRMED | NOT STARTED | Stable operation ID, retry-safe resource discovery, resume/cleanup and failure tests. |
| FVK-09 | High | Proof-of-delivery enrollment/verification path is incomplete. | PARTIALLY CONFIRMED | NOT STARTED | Authorized evidence flow, delivery/company binding, negative tests and audit trail. |
| FVK-10 | Medium | `doGet` reported `configured` while no operational API existed. | CONFIRMED | IMPLEMENTED, NOT VERIFIED | Regression tests and exact-commit CI; live readiness remains NO-GO. |
| FVK-11 | High | Actual AppSheet app, source permissions and role-specific access are unverified. | UNVERIFIABLE WITH CURRENT ACCESS | BLOCKED | Owner-authorized test environment and direct configuration/access evidence. |
| FVK-12 | Medium | CI uses Node.js 20 and does not prove Apps Script runtime compatibility; Node 20 deprecation warning was previously observed. | CONFIRMED | NOT STARTED | Review workflow/action runtime compatibility and add feasible Apps Script runtime verification. |
| FVK-13 | High | No backup restoration exercise is evidenced. | CONFIRMED (absence of evidence) | BLOCKED on test workspace/access | Backup/restore drill with measured recovery evidence. |
| FVK-14 | High | Privacy/legal and retention readiness for intended jurisdictions is not verified. | UNVERIFIABLE WITH CURRENT ACCESS | BLOCKED on policy/owner review | Data inventory, retention/erasure, provider terms and jurisdiction-specific review. |
| FVK-15 | High | Workbook initializer may create some sheets before detecting a later schema mismatch; this is a partial side effect, not a data-clearing defect. | ADDITIONAL FINDING | IMPLEMENTED, NOT VERIFIED | Fake Apps Script spreadsheet tests for empty, initialized, partial and mismatch states, then runtime verification. |
| FVK-16 | High | Delivery service checks a supplied actor object but does not prove that it came from a trusted identity provider. | CONFIRMED; overlaps FVK-01 | IN PROGRESS | Public operations must resolve identity server-side; client-supplied actor/company fields cannot authorize. |
| FVK-17 | Medium | Existing CI tests Node.js logic, not actual Apps Script, Google Workspace or Meta services. | CONFIRMED | IN PROGRESS | Keep evidence labels accurate; add runtime/adapter tests without calling them live tests. |

## Task ledger

| Task ID | Related findings | Root cause / solution | Acceptance criteria | Status and commit evidence |
|---|---|---|---|---|
| FVK-DOC-01 | All | No permanent repo-level anti-loop protocol and stable register existed at baseline. Added control document and this register. | Stable IDs, evidence levels, retry rules and launch boundary exist in the working branch. | IMPLEMENTED. Control document commit: `bbfbf72376cfa5b20a933a5e886a842e936dfaa1`; register commit: `eeb65010ba6329c6efe9edaa64a156df13ad86b7`. |
| FVK-10-FIX-01 | FVK-10 | Placeholder falsely reported `configured`. Updated GET status to `not_configured`, added explicit `operationalApi:false`, and kept POST fail-closed. | Actual `Code.js` handlers return honest, non-ready JSON and tests cover GET and POST behavior. | IMPLEMENTED, NOT VERIFIED. Code commit: `488e949869015201e2eedcac973e62636db8dbee`; tests commit: `c4ee18b1ec2524c4318c95cfbb4423199432367a`. Exact-commit CI evidence pending verification. |
| FVK-01-DESIGN-01 | FVK-01/FVK-16 | There is no trusted actor-resolution boundary. Do not wire a public operational API until identity/membership can be verified. | Unauthenticated, inactive, missing-membership and cross-tenant requests deny by default; no live endpoint enabled. | NOT STARTED. Safe design/tests can proceed without owner action; live verification requires authorized Google test access. |

## Batch evidence — 2026-10-20

- **Control protocol:** [docs/ENGINEERING_CONTROL.md](ENGINEERING_CONTROL.md), commit `bbfbf72376cfa5b20a933a5e886a842e936dfaa1`.
- **Register:** this file, commit `eeb65010ba6329c6efe9edaa64a156df13ad86b7`.
- **Entrypoint behavior:** [src/Code.js](../src/Code.js), commit `488e949869015201e2eedcac973e62636db8dbee`. GET no longer claims configuration; POST still refuses processing.
- **Regression tests:** [tests/unit/entrypoint.test.js](../tests/unit/entrypoint.test.js), commit `c4ee18b1ec2524c4318c95cfbb4423199432367a`. These use a controlled Node VM with a fake `ContentService`; they are unit tests, not a real Apps Script test.
- **Latest verified source commit at this update:** `c4ee18b1ec2524c4318c95cfbb4423199432367a`.
- **CI status:** an exact-commit run was not returned by the available commit-run query at the time of this update. Do not infer CI success from the earlier run #53, which predates these changes.

## Genuine access / owner blockers

- **Google Workspace / Apps Script / AppSheet:** no authorized live test environment or configuration evidence is available through the current repository access. Do not deploy.
- **Meta WhatsApp:** no live credentials or approved test recipient are available. Do not send messages or enable live messaging.
- **Live tenant isolation / backup restoration:** requires an owner-authorized isolated workspace and separate test identities.
- **Privacy/legal approval:** requires policy and owner review; code tests are not legal sign-off.

## Update protocol

Append new evidence with commit SHA and workflow URL. Preserve stable IDs and previous evidence. Do not close findings because related code exists. Update statuses only when the required evidence has been inspected.
