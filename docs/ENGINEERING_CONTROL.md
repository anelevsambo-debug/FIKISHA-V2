# Engineering Control and Anti-Loop Protocol

**Project:** FIKISHA-V2  
**Working branch:** `build/v2-complete`  
**Pull request:** #1 — keep draft and unmerged  
**Product boundary:** Google Apps Script, Sheets, Drive and AppSheet; WhatsApp Business Platform only when configured and authorised. No blockchain, Solidity, token delivery payments or unapproved payment rails.

## Operating rules

1. The repository branch and its commit history are the implementation source of truth. Re-check branch/PR state before each change batch.
2. The remediation register in `docs/REMEDIATION_REGISTER.md` is the stable task/finding ledger. Keep IDs stable; append evidence rather than silently replacing history.
3. Do not call a feature complete because documentation exists, a mock passes, or CI is green. Record the level of evidence: unit, adapter, integration, live test service, or deployment.
4. Never trust a client-supplied actor ID, role, or company ID as authentication. Resolve identity from a trusted platform boundary and check membership server-side before sensitive operations.
5. Fail closed when identity, tenant membership, consent, configuration, or provider authenticity cannot be established.
6. No live deployment, real customer data, live WhatsApp message, paid service activation, merge, default-branch change, or public registration without explicit owner approval.
7. Do not expose secrets in source, sheets accessible to client users, test logs, PR descriptions, or chat.
8. Google Sheets does not provide multi-record transactions. Use bounded locking, idempotency reservation, operation journals/recovery and explicit consistency limits; never describe multiple writes as atomic.
9. For any regression, compare the current code and previous fix/commit, identify why it failed, then change the design or test that failed. Do not repeat an unchanged attempt.
10. After a failed check, inspect the exact log, attempt at most one evidence-based correction for the same cause, then record the blocker. Do not rerun unchanged inputs.
11. Prefer small, reviewable commits. One file per commit where practical; coupled implementation and its acceptance test may share a commit when splitting would leave an unsafe intermediate state.
12. A successful GitHub Actions run must be tied to the exact commit SHA. It does not prove Apps Script, AppSheet, Google Workspace, Meta or production behaviour.
13. Every finding/task must have acceptance criteria, required evidence, status and commit evidence. If blocked by credentials or owner access, complete safe local/CI work and state the precise prerequisite.
14. Keep the existing approved product scope. Do not reopen settled architecture without new evidence of a security defect, material cost issue, or unmet requirement.

## Evidence/status vocabulary

Use only the following explicit states where applicable: NOT STARTED; IN PROGRESS; BLOCKED; IMPLEMENTED, NOT VERIFIED; VERIFIED IN TEST ENVIRONMENT; VERIFIED AGAINST REAL TEST SERVICE; READY FOR OWNER REVIEW; APPROVED FOR DEPLOYMENT; DEPLOYED AND VERIFIED.

A status must not jump ahead of the evidence available. Unit and adapter tests are not live-service tests. No live service or deployment claim may be made without direct, dated evidence.

## Batch checklist

- [ ] Verify working branch, current HEAD, PR #1 state, and latest matching CI.
- [ ] Link the change to stable finding/task IDs.
- [ ] State expected behaviour and acceptance tests before changing code.
- [ ] Make the smallest safe change; do not weaken or skip a failing test.
- [ ] Run available tests and inspect full failure logs if they fail.
- [ ] Review diff for secrets, accidental scope changes and legacy blockchain references.
- [ ] Commit to `build/v2-complete` without force-push or history rewriting.
- [ ] Verify the commit exists and inspect CI for that exact SHA.
- [ ] Update the remediation register and PR evidence.
- [ ] Keep launch status NO-GO until all applicable security, operational and live-service gates pass.

## Current verified boundary

As of the initial reconciliation batch, `src/Code.js` is a placeholder: `doPost` returns `WEBHOOK_NOT_CONFIGURED`; `doGet` reports `status: "configured"` despite no operational API. No live Apps Script, AppSheet, Drive, Sheets or WhatsApp integration has been verified. Do not enable the placeholder as a production webhook.


## Owner decision — WhatsApp consent and opt-out — 2026-10-20

**Decision ID:** FIKISHA-ODR-CONSENT-01  
**Owner decision:** **APPROVED — Option A, proposed safe default.**  
**Marketing:** **DISABLED** pending separate review.  
**Scope:** Policy decision only. This record does not assert that consent controls are implemented or legally/platform certified.

### Approved policy

1. Obtain and record explicit opt-in for each phone number and each applicable message purpose/category. Supplying a phone number, registering for a delivery, or being assigned as a driver is not by itself consent.
2. Record purpose and provenance: normalized phone number, consent status, exact wording or version, timestamp, collection channel/source, supporting evidence where appropriate, and the status history including later withdrawal and renewed consent.
3. An opt-out suppresses future outbound messages covered by the affected consent. Suppression applies to messages already queued but not yet sent.
4. Suppression remains until a new valid opt-in is recorded and verified for the same phone number and applicable purpose. Re-registration, delivery changes or retries do not restore consent.
5. Check the current consent and suppression state immediately before every outbound send, including retries. If consent is missing, ambiguous, revoked, unavailable or cannot be reliably verified, do not send (fail closed).
6. Service-related messages and marketing must be treated separately. Delivery/OTP/driver-status messages are not automatically exempt from legal or Meta requirements. Marketing remains disabled until a separate owner decision and policy/legal/platform review.
7. Do not provide administrators or drivers an informal override that bypasses suppression. If messaging is blocked, use an approved non-messaging operational path where available.

### Required implementation and verification gates

- Build the consent ledger and auditable status history without trusting caller-supplied consent status as authority.
- Enforce the send-time consent check in the actual outbound path, including queued sends and retries; make suppression durable and race-resistant.
- Define and test supported opt-in/opt-out capture and confirmation flows, purpose boundaries, duplicate/normalized phone handling, and controlled administrative corrections.
- Restrict access to consent records and avoid unnecessary phone-number exposure in logs; define retention and deletion rules.
- Verify Botswana legal/privacy/electronic-communications requirements and current WhatsApp Business Platform/Meta policies before activation. Repeat the assessment for Eswatini before expansion. This approval is not a legal-compliance certification.
- Test with synthetic data in an authorized non-production environment. No live WhatsApp activation or messages are authorized by this decision.

### Current enforcement status

**Consent implementation remains BLOCKED / NOT VERIFIED end-to-end.** Until the consent ledger, send-time enforcement, suppression/re-opt-in handling and required reviews are implemented and verified, outbound WhatsApp messaging must remain blocked wherever this policy applies. Safe non-messaging engineering may continue. This decision authorizes documentation of the policy only; it does not authorize code/schema changes, deployment, activation, or message sending.


## Secure WhatsApp integration candidate — 2026-10-20

**Candidate branch:** `build/secure-whatsapp-ingress-consent-outbox`  
**Status:** candidate adapter and mocked tests added; CI pending; live ingress and provider integration NOT VERIFIED.

- `src/notifications/whatsappIntegration.js` is a policy boundary requiring an injected exact-raw-body signature verifier, server-side WABA/phone allow-list, durable unique event store, current consent gate, approved-template registry and sender. It intentionally does not expose an HTTP endpoint.
- `tests/unit/whatsapp-integration.test.js` uses synthetic payloads and fake dependencies only. It does not send messages or verify real Meta/Google services.
- `docs/WHATSAPP_INTEGRATION.md` records the official provider signature/status model, raw-byte ingress constraint, retry and reconciliation rules, configuration prerequisites and release gates.
- `src/Code.js` remains a placeholder; `doPost` stays disabled. The candidate is not yet wired to a production ingress, real sender, durable provider-event ledger or verified consent store. FVK-04 and FVK-06 remain blocked. No live messages or credentials were used.
