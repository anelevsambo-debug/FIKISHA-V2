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
| FVK-01 | Critical | No authenticated operational entrypoint or trusted actor resolution is connected to a real identity source. | CONFIRMED | IN PROGRESS | Resolver contract is implemented; trusted identity provider, real membership store, authenticated entrypoint and Apps Script/runtime verification remain. |
| FVK-02 | Critical | Tenant isolation is helper-level, not end-to-end verified. | PARTIALLY CONFIRMED | BLOCKED for live verification | Cross-company positive/negative tests through sensitive operations and separate test workbooks/accounts. |
| FVK-03 | High | Delivery/event/idempotency writes are separate; concurrent duplicate requests and partial failures were not fully recovered. | CONFIRMED | IN PROGRESS | Create reservation/recovery implemented and unit-tested; transition event recovery and real concurrent Apps Script verification remain. |
| FVK-04 | High | Consent status can be supplied by a request; provenance and opt-out enforcement are missing end-to-end. | CONFIRMED | NOT STARTED | Trusted consent provenance, opt-out suppression, audit evidence and tests across every messaging path. |
| FVK-05 | High | Driver offers are not fully persisted/linked to acceptance, expiry and reoffer state. | PARTIALLY CONFIRMED | NOT STARTED | Persisted offer lifecycle, driver/company binding, expiry/reoffer and replay/concurrency tests. |
| FVK-06 | High | Inbound webhook authenticity and replay protection are not implemented. | CONFIRMED | BLOCKED on secure ingress design/runtime proof | Trusted signature-verifying ingress, replay protection and invalid-signature tests; do not enable live processing until verified. |
| FVK-07 | High | Google Sheets cannot make the current multi-record writes transactional. | CONFIRMED | IN PROGRESS as a design constraint | Explicit consistency model, operation journal/recovery, failure-injection tests, accurate docs. |
| FVK-08 | High | Provisioning may leave partial Drive/workbook resources after failure. | CONFIRMED | NOT STARTED | Stable operation ID, retry-safe resource discovery, resume/cleanup and failure tests. |
| FVK-09 | High | Proof-of-delivery enrollment/verification path is incomplete. | PARTIALLY CONFIRMED | NOT STARTED | Authorized evidence flow, delivery/company binding, negative tests and audit trail. |
| FVK-10 | Medium | `doGet` reported `configured` while no operational API existed. | CONFIRMED | IMPLEMENTED, NOT VERIFIED in Apps Script | Regression tests pass in Node VM; real Apps Script readiness remains unverified. |
| FVK-11 | High | Actual AppSheet app, source permissions and role-specific access are unverified. | UNVERIFIABLE WITH CURRENT ACCESS | BLOCKED | Owner-authorized test environment and direct configuration/access evidence. |
| FVK-12 | Medium | CI used deprecated Node 20 action runtimes and did not prove Apps Script runtime compatibility. | CONFIRMED | IN PROGRESS | Actions upgraded to v7 and test runtime to Node 24; Apps Script runtime compatibility still requires verification. |
| FVK-13 | High | No backup restoration exercise is evidenced. | CONFIRMED (absence of evidence) | BLOCKED on test workspace/access | Backup/restore drill with measured recovery evidence. |
| FVK-14 | High | Privacy/legal and retention readiness for intended jurisdictions is not verified. | UNVERIFIABLE WITH CURRENT ACCESS | BLOCKED on policy/owner review | Data inventory, retention/erasure, provider terms and jurisdiction-specific review. |
| FVK-15 | High | Workbook initializer may create some sheets before detecting a later schema mismatch; this is a partial side effect, not a data-clearing defect. | ADDITIONAL FINDING | IMPLEMENTED, NOT VERIFIED in Apps Script | Unit tests cover empty, repeat, incompatible-schema and company-mismatch states; actual runtime remains unverified. |
| FVK-16 | High | Delivery service previously accepted a supplied actor object without proving its origin. | CONFIRMED; mitigated in service contract | IN PROGRESS | Raw actor objects are rejected; a real trusted identity source and entrypoint are still required. |
| FVK-17 | Medium | CI tests Node.js logic and fake adapters, not actual Apps Script, Google Workspace or Meta services. | CONFIRMED | IN PROGRESS | Keep evidence labels accurate; add runtime/adapter tests without calling them live tests. |

## Task ledger

| Task ID | Related findings | Root cause / solution | Acceptance criteria | Status and commit evidence |
|---|---|---|---|---|
| FVK-DOC-01 | All | No permanent repo-level anti-loop protocol and stable register existed at baseline. Added control document and register. | Stable IDs, evidence levels, retry rules and launch boundary exist in the working branch. | IMPLEMENTED. Control document commit: `bbfbf72376cfa5b20a933a5e886a842e936dfaa1`; initial register commit: `eeb65010ba6329c6efe9edaa64a156df13ad86b7`. |
| FVK-10-FIX-01 | FVK-10 | Placeholder falsely reported `configured`. Updated GET status to `not_configured`, added `operationalApi:false`, and kept POST fail-closed. | Actual handlers return honest, non-ready JSON. | IMPLEMENTED, NOT VERIFIED in real Apps Script. Code commit `488e949869015201e2eedcac973e62636db8dbee`; test commit `c4ee18b1ec2524c4318c95cfbb4423199432367a`. |
| FVK-15-TEST-01 | FVK-15 | Schema initializer had no focused regression tests. Added a fake spreadsheet/sheet harness. | Empty initialization, repeat initialization preserving data, incompatible schema and company-binding mismatch are tested. | IMPLEMENTED, NOT VERIFIED in real Apps Script. Test commit `a38e1fe062c5bfb98f5328fcede3e5593b5183a4`. |
| FVK-12-CI-01 | FVK-12 | CI action runtime warning indicated old action majors; test runtime was Node 20. | Current supported action majors, reproducible install and Node 24 test run pass. | IMPLEMENTED in workflow commit `a7daed7bf09d1c37ff18b58e74d49297d9f03ca8`; run #97 uses Node 24 and passed the current code tests. |
| FVK-03-RECOVERY-01 | FVK-03/FVK-07 | Create flow checked idempotency then wrote delivery, event and idempotency separately, leaving partial failure and race windows. Added lock-protected reservation, stable operation payload, duplicate-safe delivery/event writes, completion state and retry recovery. | Same key reuses reserved delivery/event; partial event failure resumes without duplicating delivery; reservation and completion preserve original creation timestamp. | IMPLEMENTED, NOT VERIFIED against real Google Sheets. Store commit `fd3c42fc2623e1a82ddb20070364e223601b4b30`; service commit `db13e20bd5192ea2fcfa658d0e8bd9475619756d`; timestamp fixes `38d82c8364bffea7e822789babe05b88ff759e26` and `b106a2002855120afa82aba3bec7d5f5b43f6c8f`; recovery test `c015a113bc4e4820db82577a9abf5c6c02209cae`; adapter tests `8713e27ebd3583385363b269594851b1f1ac5615`. |
| FVK-01-RESOLVER-01 | FVK-01/FVK-16 | Service previously accepted a caller-constructed actor object. Added a resolver that mints frozen actor objects only after the injected identity provider and membership store confirm an active matching membership; service rejects unbranded actors. | Tests cover normalized identity, missing identity, cross-company membership, inactive membership, invalid role and caller-created actor rejection. | IMPLEMENTED, NOT VERIFIED end-to-end. Resolver commit `a7f4b72f8ab974b04e49d18ee6fd00b7dccb0feb`; resolver tests `25be959a3f24276e259b6dccf6f10556bd8381d3`; service enforcement commit `992dead82d92f5e7d4f57528857c96016eac5a98`. |
| FVK-01-DESIGN-01 | FVK-01/FVK-16 | No real trusted identity provider or membership-store adapter is connected to an operational entrypoint. | The real provider must not derive identity from an untrusted request field; membership must be checked server-side; public endpoint stays disabled until verified. | IN PROGRESS; no owner action is needed for unit-level contract work. Live verification requires authorized Google/AppSheet test access. |

## Batch evidence — 2026-10-20

- **Control protocol:** [docs/ENGINEERING_CONTROL.md](ENGINEERING_CONTROL.md), commit `bbfbf72376cfa5b20a933a5e886a842e936dfaa1`.
- **Entrypoint fix/tests:** [src/Code.js](../src/Code.js) and [tests/unit/entrypoint.test.js](../tests/unit/entrypoint.test.js); GET is honestly not configured and POST remains fail-closed.
- **Workbook schema tests:** [tests/unit/workbook-template.test.js](../tests/unit/workbook-template.test.js).
- **Create recovery:** [src/deliveries/service.js](../src/deliveries/service.js), [src/google/sheetsStore.js](../src/google/sheetsStore.js), [tests/security/idempotency-recovery.test.js](../tests/security/idempotency-recovery.test.js), and [tests/unit/sheets-store.test.js](../tests/unit/sheets-store.test.js).
- **Actor boundary:** [src/core/actorResolver.js](../src/core/actorResolver.js) and [tests/security/actor-resolver.test.js](../tests/security/actor-resolver.test.js). The contract is tested; the real authentication provider and membership-store adapter are not wired.
- **CI workflow:** [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), commit `a7daed7bf09d1c37ff18b58e74d49297d9f03ca8`; checkout/setup-node v7, Node 24, `npm ci`, tests and legacy-term scan.
- **Matching CI:** [GitHub Actions run #97](https://github.com/anelevsambo-debug/FIKISHA-V2/actions/runs/39361491672), job `118428474205`, succeeded on PR merge commit `4a19b3bbdfe806a36f7ad103db43a99fa852c961`, containing PR head `992dead82d92f5e7d4f57528857c96016eac5a98`. Result: 34 passed, 0 failed, 0 skipped; legacy-term scan passed; Node v24.21.0 used.
- **Evidence limitation:** run #97 predates the subsequent documentation commits `5f1b15691df672d9fcbbdd24308c9c2d020b1730`, `595040763949ba0b8d9ec6a161e9905ad9b7e076` and `32111550028e2886b18a53c3f57b084b9dd5ecfc`. A later exact-head run is required after this register update. These tests use fakes and do not prove real Apps Script/Google/Meta behavior.
- **Remaining consistency risk:** create recovery has unit evidence, but transition writes and audit-event appends remain separate. Real concurrent execution and lock semantics remain unverified.

## Genuine access / owner blockers

- **Google Workspace / Apps Script / AppSheet:** no authorized live test environment or configuration evidence is available through current repository access. Do not deploy.
- **Meta WhatsApp:** no live credentials or approved test recipient are available. Do not send messages or enable live messaging.
- **Live tenant isolation / backup restoration:** requires an owner-authorized isolated workspace and separate test identities.
- **Privacy/legal approval:** requires policy and owner review; code tests are not legal sign-off.

## Update protocol

Append new evidence with commit SHA and workflow URL. Preserve stable IDs and previous evidence. Do not close findings because related code exists. Update statuses only when the required evidence has been inspected.
