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
| FVK-01 | Critical | No authenticated operational entrypoint or trusted actor resolution is connected to a real identity source. | CONFIRMED | IN PROGRESS | Resolver contract and platform membership adapter are implemented; trusted identity provider, live platform workbook, authenticated entrypoint and Apps Script/runtime verification remain. |
| FVK-02 | Critical | Tenant isolation is helper-level, not end-to-end verified. | PARTIALLY CONFIRMED | BLOCKED for live verification | Cross-company positive/negative tests through sensitive operations and separate test workbooks/accounts. |
| FVK-03 | High | Delivery/event/idempotency writes are separate; concurrent duplicate requests and partial failures were not fully recovered. | CONFIRMED | IN PROGRESS | Create and transition recovery implemented and unit-tested; real concurrent Apps Script verification remains. |
| FVK-04 | High | Consent status can be supplied by a request; provenance and opt-out enforcement are missing end-to-end. | CONFIRMED | NOT STARTED | Trusted consent provenance, opt-out suppression, audit evidence and tests across every messaging path. |
| FVK-05 | High | Driver offers are not fully persisted/linked to acceptance, expiry and reoffer state. | PARTIALLY CONFIRMED | NOT STARTED | Persisted offer lifecycle, driver/company binding, expiry/reoffer and replay/concurrency tests. |
| FVK-06 | High | Inbound webhook authenticity and replay protection are not implemented. | CONFIRMED | BLOCKED on secure ingress design/runtime proof | Trusted signature-verifying ingress, replay protection and invalid-signature tests; do not enable live processing until verified. |
| FVK-07 | High | Google Sheets cannot make the current multi-record writes transactional. | CONFIRMED | IN PROGRESS as a design constraint | Explicit consistency model, operation journal/recovery, failure-injection tests, accurate docs. |
| FVK-08 | High | Provisioning may leave partial Drive/workbook resources after failure. | CONFIRMED | IN PROGRESS | Marker-verified resource discovery and duplicate detection are implemented/tested; live Google provisioning and failure recovery remain unverified. |
| FVK-09 | High | Proof-of-delivery enrollment/verification path is incomplete. | PARTIALLY CONFIRMED | NOT STARTED | Authorized evidence flow, delivery/company binding, negative tests and audit trail. |
| FVK-10 | Medium | `doGet` reported `configured` while no operational API existed. | CONFIRMED | IMPLEMENTED, NOT VERIFIED in Apps Script | Regression tests pass in Node VM; real Apps Script readiness remains unverified. |
| FVK-11 | High | Actual AppSheet app, source permissions and role-specific access are unverified. | UNVERIFIABLE WITH CURRENT ACCESS | BLOCKED | Owner-authorized test environment and direct configuration/access evidence. |
| FVK-12 | Medium | CI used deprecated Node 20 action runtimes and did not prove Apps Script runtime compatibility. | CONFIRMED | IN PROGRESS | Actions upgraded to v7 and test runtime to Node 24; run #119 passed 38 tests; Apps Script runtime compatibility still requires verification. |
| FVK-13 | High | No backup restoration exercise is evidenced. | CONFIRMED (absence of evidence) | BLOCKED on test workspace/access | Backup/restore drill with measured recovery evidence. |
| FVK-14 | High | Privacy/legal and retention readiness for intended jurisdictions is not verified. | UNVERIFIABLE WITH CURRENT ACCESS | BLOCKED on policy/owner review | Data inventory, retention/erasure, provider terms and jurisdiction-specific review. |
| FVK-15 | High | Workbook initializer may create some sheets before detecting a later schema mismatch; schema v2 adds last_operation_id and rejects v1 rather than silently changing the schema. | ADDITIONAL FINDING | IMPLEMENTED, NOT VERIFIED in Apps Script | Unit tests cover empty, repeat, incompatible-schema and company-mismatch states; actual runtime remains unverified. |
| FVK-16 | High | Delivery service previously accepted a supplied actor object without proving its origin. | CONFIRMED; mitigated in service contract | IN PROGRESS | Raw actor objects are rejected; a real trusted identity source and entrypoint are still required. |
| FVK-17 | Medium | CI tests Node.js logic and fake adapters, not actual Apps Script, Google Workspace or Meta services. | CONFIRMED | IN PROGRESS | Keep evidence labels accurate; add runtime/adapter tests without calling them live tests. |

## Task ledger

| Task ID | Related findings | Root cause / solution | Acceptance criteria | Status and commit evidence |
|---|---|---|---|---|
| FVK-DOC-01 | All | No permanent repo-level anti-loop protocol and stable register existed at baseline. Added control document and register. | Stable IDs, evidence levels, retry rules and launch boundary exist in the working branch. | IMPLEMENTED. Control document commit: `bbfbf72376cfa5b20a933a5e886a842e936dfaa1`; initial register commit: `eeb65010ba6329c6efe9edaa64a156df13ad86b7`. |
| FVK-10-FIX-01 | FVK-10 | Placeholder falsely reported `configured`. Updated GET status to `not_configured`, added `operationalApi:false`, and kept POST fail-closed. | Actual handlers return honest, non-ready JSON. | IMPLEMENTED, NOT VERIFIED in real Apps Script. Code commit `488e949869015201e2eedcac973e62636db8dbee`; test commit `c4ee18b1ec2524c4318c95cfbb4423199432367a`. |
| FVK-15-TEST-01 | FVK-15 | Schema initializer had no focused regression tests. Added a fake spreadsheet/sheet harness. | Empty initialization, repeat initialization preserving data, incompatible schema and company-binding mismatch are tested. | IMPLEMENTED, NOT VERIFIED in real Apps Script. Test commit `a38e1fe062c5bfb98f5328fcede3e5593b5183a4`. |
| FVK-12-CI-01 | FVK-12 | CI action runtime warning indicated old action majors; test runtime was Node 20. | Current supported action majors, reproducible install and Node 24 test run pass. | IMPLEMENTED in workflow commit `a7daed7bf09d1c37ff18b58e74d49297d9f03ca8`; run #117 uses Node 24 and passed 38 tests on the schema-v2 transition-recovery branch. |
| FVK-03-RECOVERY-01 | FVK-03/FVK-07 | Create and transition writes could leave partial state. Added lock-protected reservation, stable operation payloads, duplicate-safe delivery/event writes, transition last_operation_id marker, schema v2 and retry recovery. | Create and transition retries reuse reserved operation/event IDs; partial event failure recovers without duplicate state changes; old schema v1 is rejected; original creation timestamps are preserved. | IMPLEMENTED, NOT VERIFIED against real Google Sheets. Store commit `fd3c42fc2623e1a82ddb20070364e223601b4b30`; service commit `db13e20bd5192ea2fcfa658d0e8bd9475619756d`; timestamp fixes `38d82c8364bffea7e822789babe05b88ff759e26` and `b106a2002855120afa82aba3bec7d5f5b43f6c8f`; recovery test `c015a113bc4e4820db82577a9abf5c6c02209cae`; adapter tests `8713e27ebd3583385363b269594851b1f1ac5615`; transition recovery/schema v2 commit `85b7082c382b2fce5b6ce2a6274d5500527c69b0`; recovery metadata/fake-store correction `1c2b2d6d38debb9685af676cda98a127be26868b`. |
| FVK-01-RESOLVER-01 | FVK-01/FVK-16 | Service previously accepted a caller-constructed actor object. Added a resolver that mints frozen actor objects only after the injected identity provider and membership store confirm an active matching membership; service rejects unbranded actors. | Tests cover normalized identity, missing identity, cross-company membership, inactive membership, invalid role and caller-created actor rejection. | IMPLEMENTED, NOT VERIFIED end-to-end. Resolver commit `a7f4b72f8ab974b04e49d18ee6fd00b7dccb0feb`; resolver tests `25be959a3f24276e259b6dccf6f10556bd8381d3`; service enforcement commit `992dead82d92f5e7d4f57528857c96016eac5a98`; platform membership adapter commit/test batch includes `9de4bfd5ac92603fffa3d8f4c249ee09b9e17ac7`. |
| FVK-08-RECOVERY-01 | FVK-08 | A retry after a partial Drive/workbook provisioning run could create duplicate resources if a resource ID was not durably saved. Added deterministic names, company/resource description markers, unique-name discovery, duplicate detection and fail-closed identity checks. | Retry reuses a single correctly marked folder/workbook; wrong markers or duplicates fail closed; provisioning-job timestamps persist. | IMPLEMENTED, NOT VERIFIED in Google. Covered by `tests/unit/provisioning.test.js`; code/test batch at branch commit `45f6083f0a261f166cf37ac2bc275a1f3ea231ec`. |
| FVK-01-DESIGN-01 | FVK-01/FVK-16 | No real trusted identity provider is connected to an operational entrypoint. | The real provider must not derive identity from an untrusted request field; membership must be checked server-side; public endpoint stays disabled until verified. | IN PROGRESS; live verification requires authorized Google/AppSheet test access. |

## Batch evidence — 2026-10-20

- **Control protocol:** [docs/ENGINEERING_CONTROL.md](ENGINEERING_CONTROL.md), commit `bbfbf72376cfa5b20a933a5e886a842e936dfaa1`.
- **Entrypoint fix/tests:** [src/Code.js](../src/Code.js) and [tests/unit/entrypoint.test.js](../tests/unit/entrypoint.test.js); GET is honestly not configured and POST remains fail-closed.
- **Workbook schema tests:** [tests/unit/workbook-template.test.js](../tests/unit/workbook-template.test.js).
- **Create recovery:** [src/deliveries/service.js](../src/deliveries/service.js), [src/google/sheetsStore.js](../src/google/sheetsStore.js), [tests/security/idempotency-recovery.test.js](../tests/security/idempotency-recovery.test.js), and [tests/unit/sheets-store.test.js](../tests/unit/sheets-store.test.js).
- **Actor boundary:** [src/core/actorResolver.js](../src/core/actorResolver.js) and [tests/security/actor-resolver.test.js](../tests/security/actor-resolver.test.js). The contract is tested; the real authentication provider and membership-store adapter are not wired.
- **CI workflow:** [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), commit `a7daed7bf09d1c37ff18b58e74d49297d9f03ca8`; checkout/setup-node v7, Node 24, `npm ci`, tests and legacy-term scan.
- **Matching code CI:** [GitHub Actions run #136](https://github.com/anelevsambo-debug/FIKISHA-V2/actions/runs/39362366679), job `118431229027`, succeeded on PR merge commit `e71488b51eaa05ca8f52601ecd70f94edf33575b`, containing PR head `45f6083f0a261f166cf37ac2bc275a1f3ea231ec`. Result: 49 passed, 0 failed, 0 skipped; legacy-term scan passed; Node v24.21.0 used.
- **Evidence limitation:** run #136 covers code through branch head `45f6083f0a261f166cf37ac2bc275a1f3ea231ec`, but predates subsequent documentation commits `03ce1529947d102ab8162bfc244ff59013292653`, `a4ab6872f49151cd168a345020232be29a2dadba`, `b9553e670d247ac89d06e66ff60c211c3a7d23b9`, `bff3e3075f169dbb60fbefb8f2984d2b9c95374d` and `e6c447712954140b2af2bf66bc12fdf69bd47bff`. A later exact-head run is required after this register update. Tests use fakes and do not prove real Apps Script/Google/Meta behavior.
- **Remaining consistency risk:** create and transition recovery have unit evidence but are not transactional. Real concurrent execution and lock semantics remain unverified.

## Genuine access / owner blockers

- **Google Workspace / Apps Script / AppSheet:** no authorized live test environment or configuration evidence is available through current repository access. Do not deploy.
- **Meta WhatsApp:** no live credentials or approved test recipient are available. Do not send messages or enable live messaging.
- **Live tenant isolation / backup restoration:** requires an owner-authorized isolated workspace and separate test identities.
- **Privacy/legal approval:** requires policy and owner review; code tests are not legal sign-off.

## Update protocol

Append new evidence with commit SHA and workflow URL. Preserve stable IDs and previous evidence. Do not close findings because related code exists. Update statuses only when the required evidence has been inspected.
