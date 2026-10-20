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
| FVK-04 | High | Consent status can be supplied by a request; provenance and opt-out enforcement are missing end-to-end. | CONFIRMED | BLOCKED | Owner must approve the default consent rule before the ledger and messaging gate are implemented: separate explicit opt-in per phone number; any opt-out suppresses further outbound WhatsApp messages to that number. |
| FVK-05 | High | Driver offers are not fully persisted/linked to acceptance, expiry and reoffer state. | PARTIALLY CONFIRMED | NOT STARTED | Persisted offer lifecycle, driver/company binding, expiry/reoffer and replay/concurrency tests. |
| FVK-06 | High | Inbound webhook authenticity and replay protection are not implemented. | CONFIRMED | BLOCKED on secure ingress design/runtime proof | Trusted signature-verifying ingress, replay protection and invalid-signature tests; do not enable live processing until verified. |
| FVK-07 | High | Google Sheets cannot make the current multi-record writes transactional. | CONFIRMED | IN PROGRESS as a design constraint | Explicit consistency model, operation journal/recovery, failure-injection tests, accurate docs. |
| FVK-08 | High | Provisioning may leave partial Drive/workbook resources after failure. | CONFIRMED | IN PROGRESS | Marker-verified resource discovery and duplicate detection are implemented/tested; live Google provisioning and failure recovery remain unverified. |
| FVK-09 | High | Proof-of-delivery enrollment/verification path is incomplete. | PARTIALLY CONFIRMED | NOT STARTED | Authorized evidence flow, delivery/company binding, negative tests and audit trail. |
| FVK-10 | Medium | `doGet` reported `configured` while no operational API existed. | CONFIRMED | IMPLEMENTED, NOT VERIFIED in Apps Script | Regression tests pass in Node VM; real Apps Script readiness remains unverified. |
| FVK-11 | High | Actual AppSheet app, source permissions and role-specific access are unverified. | UNVERIFIABLE WITH CURRENT ACCESS | BLOCKED | Owner-authorized test environment and direct configuration/access evidence. |
| FVK-12 | Medium | CI used deprecated Node 20 action runtimes and did not prove Apps Script runtime compatibility. | CONFIRMED | IN PROGRESS | Actions upgraded to v7 and test runtime to Node 24; run #171 passed 55 tests; Apps Script runtime compatibility still requires verification. |
| FVK-13 | High | No backup restoration exercise is evidenced. | CONFIRMED (absence of evidence) | BLOCKED on test workspace/access | Backup/restore drill with measured recovery evidence. |
| FVK-14 | High | Privacy/legal and retention readiness for intended jurisdictions is not verified. | UNVERIFIABLE WITH CURRENT ACCESS | BLOCKED on policy/owner review | Data inventory, retention/erasure, provider terms and jurisdiction-specific review. |
| FVK-15 | High | Workbook initializer may create some sheets before detecting a later schema mismatch; schema v2 adds last_operation_id and rejects v1 rather than silently changing the schema. | ADDITIONAL FINDING | IMPLEMENTED, NOT VERIFIED in Apps Script | Unit tests cover empty, repeat, incompatible-schema and company-mismatch states; actual runtime remains unverified. |
| FVK-16 | High | Delivery service previously accepted a supplied actor object without proving its origin. | CONFIRMED; mitigated in service contract | IN PROGRESS | Raw actor objects are rejected; a real trusted identity source and entrypoint are still required. |
| FVK-17 | Medium | CI tests Node.js logic and fake adapters, not actual Apps Script, Google Workspace or Meta services. | CONFIRMED | IN PROGRESS | Keep evidence labels accurate; add runtime/adapter tests without calling them live tests. |
| FVK-18 | High | Company provisioning previously trusted caller-supplied `role: DEVELOPER` and `platform_admin: true` fields. | CONFIRMED | IMPLEMENTED, NOT VERIFIED | Provisioning now requires a resolver-branded platform-admin actor from a separate PlatformAdmins registry; raw actors and ordinary company admins are rejected in tests. Real identity provider/live registry remains unverified. |

## Task ledger

| Task ID | Related findings | Root cause / solution | Acceptance criteria | Status and commit evidence |
|---|---|---|---|---|
| FVK-DOC-01 | All | No permanent repo-level anti-loop protocol and stable register existed at baseline. Added control document and register. | Stable IDs, evidence levels, retry rules and launch boundary exist in the working branch. | IMPLEMENTED. Control document commit: `bbfbf72376cfa5b20a933a5e886a842e936dfaa1`; initial register commit: `eeb65010ba6329c6efe9edaa64a156df13ad86b7`. |
| FVK-10-FIX-01 | FVK-10 | Placeholder falsely reported `configured`. Updated GET status to `not_configured`, added `operationalApi:false`, and kept POST fail-closed. | Actual handlers return honest, non-ready JSON. | IMPLEMENTED, NOT VERIFIED in real Apps Script. Code commit `488e949869015201e2eedcac973e62636db8dbee`; test commit `c4ee18b1ec2524c4318c95cfbb4423199432367a`. |
| FVK-15-TEST-01 | FVK-15 | Schema initializer had no focused regression tests. Added a fake spreadsheet/sheet harness. | Empty initialization, repeat initialization preserving data, incompatible schema and company-binding mismatch are tested. | IMPLEMENTED, NOT VERIFIED in real Apps Script. Test commit `a38e1fe062c5bfb98f5328fcede3e5593b5183a4`. |
| FVK-12-CI-01 | FVK-12 | CI action runtime warning indicated old action majors; test runtime was Node 20. | Current supported action majors, reproducible install and Node 24 test run pass. | IMPLEMENTED in workflow commit `a7daed7bf09d1c37ff18b58e74d49297d9f03ca8`; run #171 uses Node 24 and passed 55 tests including platform-admin resolution and provisioning authorization tests. |
| FVK-03-RECOVERY-01 | FVK-03/FVK-07 | Create and transition writes could leave partial state. Added lock-protected reservation, stable operation payloads, duplicate-safe delivery/event writes, transition last_operation_id marker, schema v2 and retry recovery. | Create and transition retries reuse reserved operation/event IDs; partial event failure recovers without duplicate state changes; old schema v1 is rejected; original creation timestamps are preserved. | IMPLEMENTED, NOT VERIFIED against real Google Sheets. Store commit `fd3c42fc2623e1a82ddb20070364e223601b4b30`; service commit `db13e20bd5192ea2fcfa658d0e8bd9475619756d`; timestamp fixes `38d82c8364bffea7e822789babe05b88ff759e26` and `b106a2002855120afa82aba3bec7d5f5b43f6c8f`; recovery test `c015a113bc4e4820db82577a9abf5c6c02209cae`; adapter tests `8713e27ebd3583385363b269594851b1f1ac5615`; transition recovery/schema v2 commit `85b7082c382b2fce5b6ce2a6274d5500527c69b0`; recovery metadata/fake-store correction `1c2b2d6d38debb9685af676cda98a127be26868b`. |
| FVK-01-RESOLVER-01 | FVK-01/FVK-16 | Service previously accepted a caller-constructed actor object. Added a resolver that mints frozen actor objects only after the injected identity provider and membership store confirm an active matching membership; service rejects unbranded actors. | Tests cover normalized identity, missing identity, cross-company membership, inactive membership, invalid role and caller-created actor rejection. | IMPLEMENTED, NOT VERIFIED end-to-end. Resolver commit `a7f4b72f8ab974b04e49d18ee6fd00b7dccb0feb`; resolver tests `25be959a3f24276e259b6dccf6f10556bd8381d3`; service enforcement commit `992dead82d92f5e7d4f57528857c96016eac5a98`; platform membership adapter commit/test batch includes `9de4bfd5ac92603fffa3d8f4c249ee09b9e17ac7`; platform workbook initializer/test batch includes `ad5c6a75ece9df841318e05e34d3e905bb28495f`; separate platform-admin resolver/registry commit `8a4dd115e2fbb9fae8cad51e983138b0fa9895e1`; provisioner enforcement commit `e30483e72f016b17c4de61439cd35113b704d729`; schema-count test correction `64ff0855b8f665e19ef310cc67eb55910abad35a`. |
| FVK-08-RECOVERY-01 | FVK-08 | A retry after a partial Drive/workbook provisioning run could create duplicate resources if a resource ID was not durably saved. Added deterministic names, company/resource description markers, unique-name discovery, duplicate detection and fail-closed identity checks. | Retry reuses a single correctly marked folder/workbook; wrong markers or duplicates fail closed; provisioning-job timestamps persist. | IMPLEMENTED, NOT VERIFIED in Google. Covered by `tests/unit/provisioning.test.js`; code/test batch at branch commit `45f6083f0a261f166cf37ac2bc275a1f3ea231ec`. |
| FVK-01-BOOTSTRAP-01 | FVK-01/FVK-08 | No non-destructive initializer existed for the platform registry workbook. Added Companies, CompanyMembers, PlatformAdmins, ProvisioningJobs and PlatformConfig initialization with header/version checks (schema v2). | Empty init, repeat initialization preserving data, incompatible header and old schema version rejection pass in unit tests. | IMPLEMENTED, NOT VERIFIED against Google. Initial code commit `5a9cc19455d23e7b7c09bb63cef0693a9b5ff512`; schema-v2/platform-admin update commit `8a4dd115e2fbb9fae8cad51e983138b0fa9895e1`; tests/final passing fix commit `64ff0855b8f665e19ef310cc67eb55910abad35a`. |
| FVK-08-ADMIN-01 | FVK-08/FVK-18 | Provisioning trusted raw actor fields rather than a resolver-branded platform admin. Added a separate PlatformAdmins registry and resolver method. | Forged actor objects fail; a valid company admin cannot provision; only an active platform-admin record can mint a trusted provisioning actor. | IMPLEMENTED, NOT VERIFIED end-to-end; tested with fake registry. |
| FVK-01-DESIGN-01 | FVK-01/FVK-16 | No real trusted identity provider is connected to an operational entrypoint. | The real provider must not derive identity from an untrusted request field; membership must be checked server-side; public endpoint stays disabled until verified. | IN PROGRESS; live verification requires authorized Google/AppSheet test access. |

## Batch evidence — 2026-10-20

- **Platform registry:** [src/platform/platformStore.js](../src/platform/platformStore.js) and [tests/unit/platform-store.test.js](../tests/unit/platform-store.test.js) test company/member lookup, duplicate membership denial, job upserts and resolver integration using fake Sheets.
- **Platform bootstrap:** [src/platform/platformWorkbookTemplate.js](../src/platform/platformWorkbookTemplate.js) and [tests/unit/platform-workbook-template.test.js](../tests/unit/platform-workbook-template.test.js) test non-destructive initialization and schema-version rejection, including the PlatformAdmins tab.
- **Platform-admin security:** [src/core/actorResolver.js](../src/core/actorResolver.js), [src/companies/provisioning.js](../src/companies/provisioning.js) and [tests/unit/provisioning.test.js](../tests/unit/provisioning.test.js) verify that provisioning requires a trusted platform-admin actor.
- **Provisioning recovery:** [src/companies/provisioning.js](../src/companies/provisioning.js) and [tests/unit/provisioning.test.js](../tests/unit/provisioning.test.js) test reuse of uniquely marked resources and fail-closed duplicate/mismatch handling.

- **Control protocol:** [docs/ENGINEERING_CONTROL.md](ENGINEERING_CONTROL.md), commit `bbfbf72376cfa5b20a933a5e886a842e936dfaa1`.
- **Entrypoint fix/tests:** [src/Code.js](../src/Code.js) and [tests/unit/entrypoint.test.js](../tests/unit/entrypoint.test.js); GET is honestly not configured and POST remains fail-closed.
- **Workbook schema tests:** [tests/unit/workbook-template.test.js](../tests/unit/workbook-template.test.js).
- **Create recovery:** [src/deliveries/service.js](../src/deliveries/service.js), [src/google/sheetsStore.js](../src/google/sheetsStore.js), [tests/security/idempotency-recovery.test.js](../tests/security/idempotency-recovery.test.js), and [tests/unit/sheets-store.test.js](../tests/unit/sheets-store.test.js).
- **Actor boundary:** [src/core/actorResolver.js](../src/core/actorResolver.js) and [tests/security/actor-resolver.test.js](../tests/security/actor-resolver.test.js). The contract is tested; the real authentication provider and membership-store adapter are not wired.
- **CI workflow:** [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), commit `a7daed7bf09d1c37ff18b58e74d49297d9f03ca8`; checkout/setup-node v7, Node 24, `npm ci`, tests and legacy-term scan.
- **Matching code CI:** [GitHub Actions run #171](https://github.com/anelevsambo-debug/FIKISHA-V2/actions/runs/39363002337), job `118433267839`, succeeded on PR merge commit `2926a45f0cd4fb19f152fe517759bdda566b4db1`, containing PR head `64ff0855b8f665e19ef310cc67eb55910abad35a`. Result: 55 passed, 0 failed, 0 skipped; legacy-term scan passed; Node v24.21.0 used.
- **Evidence limitation:** run #171 covers code through branch head `64ff0855b8f665e19ef310cc67eb55910abad35a`, but predates documentation commits `518428826e4bf155b8f618cf8233a8ed37e3a712`, `7d6676f233a85393b2aad1f6947587a8e65cf528`, `3a585d2ce9daa1c1b0a89af4548364b6b8e82b09`, `800945d703625823078d2e54325ae947134edbf6` and this register update. Tests use fakes and do not prove real Apps Script/Google/Meta behavior.
- **Remaining consistency risk:** create and transition recovery have unit evidence but are not transactional. Real concurrent execution and lock semantics remain unverified.

## Genuine access / owner blockers

- **Consent policy decision (owner):** recommended default is separate explicit opt-in per phone number before WhatsApp messaging, with opt-out permanently suppressing future outbound messages to that number until a new valid opt-in is recorded. Consent enforcement must remain blocked until the owner approves or changes this rule.

- **Google Workspace / Apps Script / AppSheet:** no authorized live test environment or configuration evidence is available through current repository access. Do not deploy.
- **Meta WhatsApp:** no live credentials or approved test recipient are available. Do not send messages or enable live messaging.
- **Live tenant isolation / backup restoration:** requires an owner-authorized isolated workspace and separate test identities.
- **Privacy/legal approval:** requires policy and owner review; code tests are not legal sign-off.

## Update protocol

Append new evidence with commit SHA and workflow URL. Preserve stable IDs and previous evidence. Do not close findings because related code exists. Update statuses only when the required evidence has been inspected.

## Engineering continuation — 2026-10-20 — P0-01

**Candidate HEAD:** 6c87ba2ad1e4134090daa830a3d7f9bbf425db79  
**PR:** [#1 — draft, unmerged](https://github.com/anelevsambo-debug/FIKISHA-V2/pull/1)  
**Task status:** **BLOCKED — security regression guard added; trusted identity integration not closed.**

### Root cause confirmed

src/core/actorResolver.js defines a resolver contract that depends on an injected getAuthenticatedEmail function and a server-side membership store. No real trusted identity provider or authenticated invocation context is wired into the project. src/Code.js intentionally keeps doPost disabled and returns WEBHOOK_NOT_CONFIGURED; the existing endpoint is not an operational API.

The safe correction cannot be to trust email, actor_id, role, platform_admin, or company_id supplied in request parameters or JSON. Selecting and verifying a real authentication/invocation model requires an authorized Google/AppSheet test environment and evidence of how caller identity is established. Until then, the operational endpoint must remain disabled.

### Acceptance criteria for P0-01 closure

1. A real trusted invocation identity is obtained independently of caller-controlled request fields.
2. Active company membership and role are resolved server-side from the platform-controlled registry.
3. Positive test: an authorized test actor can invoke a harmless operation in the correct company.
4. Negative/adversarial tests reject missing identity, forged email/actor/role/company fields, inactive membership, invalid role, wrong-company membership and replayed/unauthorized invocation as applicable to the chosen boundary.
5. Rejected requests perform no protected reads or writes.
6. The chosen path is tested in an authorized non-production Apps Script/Google environment, with exact commit and test evidence recorded.
7. doPost remains disabled until all preceding evidence exists.

### Safe regression guard added

- **File:** tests/unit/entrypoint.test.js
- **Commit:** 6c87ba2ad1e4134090daa830a3d7f9bbf425db79
- **Change:** added a regression test supplying forged identity and authority fields through parameter, parameters, JSON postData, and a combined request shape. Each attempt must receive the unchanged fail-closed WEBHOOK_NOT_CONFIGURED response.
- **CI:** [Run #181](https://github.com/anelevsambo-debug/FIKISHA-V2/actions/runs/39434043311) succeeded on this exact candidate HEAD. Job logs report **56 tests passed, 0 failed, 0 skipped**; npm run check:legacy-terms also passed.
- **Evidence class:** VERIFIED in Node.js CI for the disabled placeholder only. This does not verify Apps Script runtime behavior or complete P0-01.

### Not tested / remaining blockers

- No real identity provider or trusted Apps Script/AppSheet invocation identity.
- No live platform workbook or end-to-end server-side membership lookup through an authenticated endpoint.
- No real Apps Script runtime, Google permissions, or protected-operation side-effect test.
- No production deployment; none is authorized.

**Closure decision:** P0-01 remains **BLOCKED**. Do not mark it complete on the strength of the regression test or green CI. Do not proceed to P0-02 implementation in this cycle.

## P0-01 continuation — 2026-10-20 — resolver failure handling and adversarial tests

**Status: BLOCKED for live identity verification; safe code/test work completed.**

### Identity and authorization path verified in source

- Apps Script handlers: `src/Code.js` — GET returns `OPERATIONAL_API_NOT_CONFIGURED`; POST returns `WEBHOOK_NOT_CONFIGURED`. Neither invokes operational services.
- Resolver: `src/core/actorResolver.js` — accepts an injected trusted identity provider and membership store; it does not itself authenticate a caller.
- Platform registry: `src/platform/platformStore.js` — looks up company membership and platform administrators separately in server-controlled Sheets tabs; duplicate records fail closed.
- Delivery authorization: `src/deliveries/service.js` — rejects unbranded actors, enforces company matching and action-specific roles.
- Provisioning authorization: `src/companies/provisioning.js` — requires a resolver-branded active platform-admin actor, not a client-supplied role flag.
- Design decision documented in `docs/ARCHITECTURE.md`: do not assume Apps Script `Session` APIs prove the end user for every deployment mode; select the identity provider only after verifying the exact Google invocation mode.

### Code and tests

- Resolver code commit: `9dee562e6a2a8b64c12bda0517d9a8194e247434`. Unexpected identity-provider errors now return `IDENTITY_PROVIDER_FAILURE`; unexpected membership/admin registry failures return `IDENTITY_REGISTRY_UNAVAILABLE`, without exposing exception messages. Explicit domain error codes remain available.
- Security-test commit: `7398d012ae76b3aca1b89fdde02d00998da3b124`. Added tests for forged email/actor/role/company fields, forged company context, unknown actor, identity-provider failure, registry failure, platform-admin/company-role separation and inactive platform admin.
- Architecture decision commit: `cdd3079035c88dbcb7934d7153e95ad13ce793d0`.
- **CI run #187** on the security-test commit passed: 63 tests passed, 0 failed, 0 skipped; legacy-term scan passed. [Run #187](https://github.com/anelevsambo-debug/FIKISHA-V2/actions/runs/39434975666).
- Existing actual-path tests also exercise authorized delivery creation, cross-company delivery access denial, and rejection of raw actor objects in the delivery service; provisioning tests reject raw actors and ordinary company admins for platform-admin-only provisioning.

### Required test coverage and evidence boundaries

| Required case | Automated evidence | Live Google evidence |
|---|---|---|
| Missing identity | Covered | Not available |
| Forged email/actor/role/company | Covered at resolver boundary | Not available |
| Unknown actor | Covered | Not available |
| Disabled/revoked membership | Inactive company and platform-admin cases covered | Not available |
| Cross-company resource access | Delivery-service test exists | Not available |
| Unauthorized platform-admin action | Provisioning test rejects raw actor and company admin | Not available |
| Authorized allowed action | Delivery creation through trusted test resolver | Not available |
| Identity-provider/registry failure | Covered; exception detail is not propagated | Not available |

Tests use Node.js VM and fake registry/store adapters. They prove the authorization decision logic for those supplied dependencies, not the trustworthiness of a real identity provider or real Google services.

### P0-01 closure decision

**P0-01 remains BLOCKED.** No supported trusted identity provider is currently wired to an authenticated operational entrypoint, and no authorized non-production Google identity test was available. Do not enable `doPost`, do not use request-supplied identity fields as authority, and do not mark the application production-secure. No P0-02 implementation was started.

## P0-02 continuation — 2026-10-20 — Tenant isolation and Google resource binding

**Status: PARTIALLY VERIFIED for logical authorization; live Google resource isolation UNKNOWN / NOT VERIFIED.**

### Findings confirmed from repository code

- `src/platform/platformStore.js` is the server-controlled Companies / CompanyMembers / PlatformAdmins / ProvisioningJobs registry adapter. It validates headers and rejects duplicate company, membership, administrator and job records. It does not itself establish caller identity.
- `src/companies/provisioning.js` provisions resources using company-specific deterministic names and description markers, checks for duplicate names and wrong markers, and uses persisted job IDs to resume retries. It previously accepted any non-`SUSPENDED` status and did not validate a returned company's identity or provisioning job's company binding.
- `src/google/sheetsStore.js` used to return the first delivery row with a matching ID. Duplicate IDs could therefore make tenant resolution ambiguous.
- `src/core/tenants.js` previously exposed only a small context helper and row-company comparison; there was no complete helper that derived workbook and folder resources from the authorized company registry record.
- There are no separate operational methods for direct delivery deletion or evidence attachment in the current delivery service. Existing protected operations are create, transition and get. Evidence is referenced through company-bound proof records during transition checks.
- No real Google workbook, Drive folder, AppSheet app, sharing ACL or test account was available. Logical authorization cannot establish direct Google-resource ACL isolation.

### Changes committed

- `dd7adc49cb857e58fd38d0196e819ccaf50bae9c` — Sheets store fails closed on duplicate delivery IDs, rejects an ID bound to another company, and checks company binding before updating a delivery.
- `bf260e4316bb6e4215c6a19f5d0161a358636362` — added tests for duplicate cross-tenant IDs, foreign-company ID reuse and cross-tenant save attempts.
- `b00402d892c565102409a46b0d904c4f6838698a` — provisioning requires exact company registry identity and ACTIVE status, and rejects a provisioning job associated with another company.
- `43c7cdc4035a60e25dd91f3b36cada6bc7abb324` and `36fbe8485c00de4b0a488d4985e68bf2918cd8f8` — introduced `resolveTenantResources`, which authorizes a resolver-branded actor, reads resource IDs only from the Companies registry, validates folder/workbook markers and CompanyConfig company/schema binding, and fails closed on registry/resource lookup failures.
- `584cd0c919a3267c36a2f26c82f4a65746a3901f` — added synthetic Company A / Company B resource-binding tests.
- `39ca70f370f09c17f8a3b177dd146b0ea01239c5` and `c9fc54606c6e0f4bc5562092dbb4abd220bd9e26` — added provisioning tests for disabled companies, mismatched registry identity, foreign workbook markers and mismatched job ownership.
- `fda5758cdc17b30a584905828bdb0eca829a4e78` — added delivery-service tests proving Company B cannot read/transition Company A delivery records and foreign-company proof does not authorize completion.
- `c022662f460e53ceb5ced7dbb4b2472325e17545` — documented tenant binding design and live ACL evidence boundary.

### Required adversarial evidence

| Case | Repository test evidence | Live Google evidence |
|---|---|---|
| Company A resolves only its own registry-bound workbook/folder | Added synthetic fixture test | UNKNOWN |
| Company A cannot read or transition Company B delivery | Existing cross-company test plus new cross-tenant transition test | UNKNOWN |
| Changing company ID does not change actor authority | Added trusted-actor company mismatch test | UNKNOWN |
| Forged workbook / folder IDs or foreign resource markers | Added marker and registry-binding tests; resolver does not accept client IDs | UNKNOWN |
| Unknown or disabled company | Added resolver/provisioner tests | UNKNOWN |
| Retry after partial provisioning avoids duplicates | Existing lost-job-reference and marked-resource reuse tests retained | UNKNOWN |
| Schema mismatch is rejected diagnostically | Existing schema-v2 tests plus CompanyConfig binding/version tests | UNKNOWN |
| Missing/invalid registry bindings do not fall back | Added missing-ID, registry-failure and foreign-binding tests | UNKNOWN |
| Direct Drive/Sheets access blocked by ACLs | Not testable with current access | UNKNOWN |

### CI verification

- [GitHub Actions run #215](https://github.com/anelevsambo-debug/FIKISHA-V2/actions/runs/39436918301) ran on exact current code head `6077fd68366a5f82df7260a93a7a8d22625ce087`: 81 tests passed, 0 failed, 0 skipped; `npm run check:legacy-terms` passed.
- Earlier run #213 exposed a test-harness cross-VM object-prototype assertion, not a production-code failure. The assertion was corrected to compare serialized state, and run #215 passed.

### Closure decision

P0-02 is **not closed**. Logical code-level isolation has been strengthened, but this task's live Google resource access-control requirement cannot be proven without an authorized non-production Google workspace and separate Company A / Company B accounts. Resource description markers do not replace ACLs. No real customer records or production permissions were changed. P0-03 and other remediation IDs were not started.


## Runtime reliability continuation — 2026-10-20 — Concurrency, idempotency and recovery

**Candidate branch:** `reliability/concurrency-recovery`  
**Baseline:** `97386e6136d111aff92af8edc794cb675554a3f3`  
**Status:** CODE CHANGES ADDED; CI AND REVIEW PENDING. Live Google runtime remains unverified.

### Source findings

- `src/google/sheetsStore.js` previously locked individual writes but did not expose a lock spanning a complete create/transition operation. The service could read a delivery, reserve an operation, and then write separate records without one shared critical section.
- Idempotency lookup and reservation previously selected the first matching key. Duplicate persisted keys could cause an arbitrary record to be treated as authoritative.
- Create idempotency checked actor ownership but did not bind a key to the original payload; the same actor could accidentally reuse a key with different delivery details and receive the old result.
- Provisioning used persisted job IDs and marked-resource discovery, but did not run the whole provisioning sequence under the platform registry's script lock.
- Lock acquisition errors could escape as raw runtime errors; lock release errors could mask an earlier operation error. There was no structured, privacy-safe log for these lock paths.

### Candidate changes

- `src/google/sheetsStore.js`: add a bounded, reentrant `runExclusive` critical section; normalize lock-provider/acquisition/release failures; emit structured logs with component/event/error-code only; fail closed on duplicate idempotency keys during lookup/reservation/completion/update.
- `src/deliveries/service.js`: execute create and transition flows under the store's exclusive lock, covering the initial read, reservation, delivery update, event write and completion record. Bind create idempotency keys to the actor and normalized delivery payload.
- `src/platform/platformStore.js`: add a bounded, reentrant exclusive section for compound platform operations, with privacy-safe lock logs.
- `src/companies/provisioning.js`: execute provisioning under the platform store's exclusive section and log a safe error code and current stage, without provider exception text or customer fields.
- Tests added for same-key retries, conflicting lifecycle requests, lost response after successful commit, completed-action replay, mismatched payload reuse, lock acquisition/release errors, duplicate idempotency rows, nested lock behavior, duplicate provisioning, and recovery after a resource is created but its identifier cannot be saved.

### Evidence required before closure

- Run GitHub Actions on the exact candidate HEAD and inspect failing/passing test names rather than using the test count as the reliability argument.
- Verify the concurrent-request tests are recognized as deterministic mock tests only: Node's synchronous service harness does not prove two Apps Script executions overlapped in real Google.
- Live test must use an owner-authorized non-production Google Workspace, synthetic company records, and isolated resources. Test Apps Script `LockService`, Sheets write outcomes after injected/transient errors, Drive creation/marker persistence, and resource ID recovery. No such live evidence is currently available.
- No automatic blind retry was introduced for Google API writes. An invocation fails with a safe code; a caller may re-submit only through the idempotent operation/recovery path. Live quota/transient error behavior and retry rate limits remain unverified.

### Current closure decision

**Do not close this finding yet.** Even after passing CI, only code paths exercised by mocks will be VERIFIED. Real simultaneous Apps Script execution, Google service error semantics, quota behavior, Drive/Sheets persistence timing, and live lock release behavior remain UNKNOWN until the authorized runtime suite is run. No deployment or production data use is authorized.
