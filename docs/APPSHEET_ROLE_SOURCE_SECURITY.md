# AppSheet Role Interfaces and Source Security

**Task:** FVK-APP-SEC-01  
**Status:** DESIGN AND SYNTHETIC CONTRACT TESTS ONLY — NOT LIVE VERIFIED  
**Policy:** no AppSheet app creation, publication, paid activation, or live Google permission changes in this task.

## 1. Security decision

AppSheet is a user interface and controlled data-sync layer, not the sole authorization boundary. Slices, view filters, Show_If, action visibility and client expressions improve usability but must never be the only protection for sensitive records or writes.

The trusted backend remains authoritative for company membership, role/action authorization, assigned-driver checks, state transitions, evidence access and privileged provisioning. At present, FIKISHA-V2 has no authenticated operational request-to-actor path; src/Code.js deliberately leaves doPost disabled. Consequently, do not enable privileged write actions or connect AppSheet to an unverified write endpoint. This document defines the target and verification plan; it does not claim a configured AppSheet app.

Google's AppSheet documentation explicitly says security filters are not a complete security solution and source data must also be protected. See links in §8.

## 2. Role-to-record and action matrix

All access is deny-by-default. “Company scope” means the company ID resolved from the trusted platform registry, never a value supplied by a form, URL, editable column, or user expression.

| Role | Records allowed | Permitted actions | Explicitly denied |
|---|---|---|---|
| Platform administrator | Platform registry: Companies, CompanyMembers, PlatformAdmins and ProvisioningJobs. Delivery content is not visible by default; access to a company workbook requires a separate, audited support need and least-privilege grant. | Provision/disable companies; manage platform membership; inspect provisioning state; repair provisioning only through the trusted platform-admin service contract. | Ordinary delivery dispatch, driver proof, consent override, unrestricted browsing of delivery photos/recipient details, using company membership as platform-admin authority. |
| Company administrator | Only the administrator's own company workbook: company deliveries, events, drivers/offers, outbox summaries and proof status. Sensitive proof files and full phone numbers are restricted to an operational need. | Company-level administration and backend-approved actions: ISSUE_QUOTE, CANCEL, RESOLVE, OWNER_OVERRIDE only where the state machine permits. | Other companies' rows/files; platform registry administration; assigning platform roles; bypassing backend state or consent controls; arbitrary proof/evidence browsing. |
| Dispatcher | Own-company delivery queue, operational event history, eligible drivers, offers and notification/outbox state needed to dispatch. No platform registry or unrelated company records. | VALIDATE_OK, VALIDATE_FAIL, ISSUE_QUOTE, ACCEPT_QUOTE, REJECT_QUOTE, OFFER_TO_DRIVER, REOFFER, CANCEL, RESOLVE, CLOSE, RAISE_DISPUTE, OPEN_INCIDENT, subject to backend state and membership checks. | Platform/company membership management; editing consent evidence to bypass policy; viewing another company's deliveries; marking proof verified outside the approved workflow. |
| Driver | Only deliveries assigned to that driver, offers addressed to that driver, and evidence/status records for those deliveries that the driver is authorized to see. No general company delivery list. | ACCEPT_OFFER, DECLINE_OFFER, CONFIRM_COLLECTION, START_TRANSIT, ATTEMPT_DELIVERY, VERIFY_OTP, FAIL_DELIVERY, only when the authenticated actor is the active assigned driver or recipient of the relevant offer and the transition is valid. | Other drivers' offers; unassigned deliveries; company administration; dispatcher actions; unrestricted recipient details; unrelated or restricted evidence; self-assignment; replaying another delivery's OTP/evidence. |

The action names above must remain aligned with src/core/permissions.js and the state machine. A button being hidden is not proof that the action is denied. The backend must re-resolve identity, company membership, role and resource binding for every write.

## 3. Recommended app and data-source topology

1. **Platform administration app:** separate AppSheet app and platform registry source. Share only with explicitly approved platform administrators. Do not include delivery tables by default.
2. **Company operations app:** one company-scoped app/source configuration per company for the initial rollout. Each company has its own workbook and Drive root. Company administrators and dispatchers can share a company app only where the row/action policies differ safely. Never combine Company A and Company B workbooks into a shared source merely for convenience.
3. **Driver app:** separate, minimal app surface from the company administration interface. Use only required operational tables/columns; apply an assignment-based security filter and separate driver-specific views. Backend still checks assigned-driver identity on every operation. Do not add an “all deliveries” fallback view.
4. **Evidence:** keep Drive files outside broadly shared folders. Use server-resolved delivery folders, restricted file ACLs, and evidence metadata tied to company + delivery + proof challenge. AppSheet should expose a controlled link or backend-mediated access only after authorization; do not store public Drive URLs or make the folder link-accessible.
5. **Backend authority:** all state transitions, provisioning, role changes, consent changes, proof verification, and privileged writes must go through a trusted backend boundary. Until a trusted authenticated invocation path is implemented and verified, these write operations remain disabled. AppSheet direct edits to sensitive source tables must not be used as a substitute.

This topology is intentionally conservative. It may mean separate app copies per company and more administration, but reduces the impact of a misconfigured tenant filter. Revisit only after real test-environment evidence demonstrates equivalent isolation with a shared app.

## 4. AppSheet configuration checklist (not yet applied)

For each app:

- **Security → Require sign-in:** enable. Select the approved identity provider (Google only if all users have suitable accounts). Do not enable “Allow all signed-in users”; maintain an explicit allow-list or approved group.
- **Access:** use app-creator mode only when the source is private to the app owner and every exposed table/column is reviewed; remember that app users may see/update data through the app even without direct Sheet access. Consider app-user mode only if every user has correct direct source permissions and this is intentional.
- **Security → Security filters:** add filters to every table containing company-scoped data. Resolve membership from server-controlled data keyed to the authenticated user, not editable user settings. Use assignment filters for driver delivery/evidence rows. If a required membership/assignment lookup is missing or ambiguous, the filter must exclude the row.
- **Slices and views:** use them for usability, not as the security boundary. Do not rely on Show_If, Editable_If, Valid_If, hidden actions or navigation restrictions to deny data.
- **Actions and automation:** no direct action may bypass backend authorization. Disable app-side Add/Update/Delete on sensitive tables unless an explicitly approved source-level policy makes the operation safe. Avoid bots triggered by direct edits to privileged tables until actor identity and authorization are verified.
- **Columns:** hide secrets, tokens, webhook verification values, HMAC keys, provider credentials and internal auth claims from all AppSheet tables/expressions. Do not put secrets in expressions, virtual columns, URLs, app formulas, logs, or ordinary Sheets.
- **Sync/cache/offline:** review offline use, delayed sync and device cache before enabling; avoid syncing proof images, full phone numbers, or cross-company rows to driver devices. Test sign-out, account switching, revocation and stale offline edits.
- **Audit:** log actor, company, operation, resource ID, result code and timestamp without logging OTPs, secrets, message bodies, or unnecessary personal data.
- **Licensing:** determine current Workspace/AppSheet entitlement and each internal/external user's required licence before sharing. Do not purchase or activate licences in this task.

Illustrative filter intent (not copy-paste-ready until the exact AppSheet schema and identity lookup are verified):
- Company rows: include only when a trusted server-controlled membership lookup maps USEREMAIL() to the row's company_id and active status.
- Driver delivery rows: include only when the authenticated user's unique active driver membership maps to the same company and the row's driver_id equals that membership's driver_id.
- Driver offer rows: include only when the offer's driver_id matches the authenticated driver's unique active membership.
- Evidence rows: include only for an authorized assigned delivery and the specific evidence types/columns the driver needs.

Do not put a caller-editable company ID or role in the filter and then treat it as trusted authority. AppSheet expressions are configuration, not a replacement for the backend actor resolver.

## 5. Source-level access and direct paths

A separate test is required for every source, not just the AppSheet UI.

- Platform registry workbook: direct access only to the smallest approved platform operator group; ordinary company admins, dispatchers and drivers must be denied.
- Company A workbook and Drive root: Company A's approved operators only; Company B identities must be denied direct open, export, copy, and file listing.
- Company B workbook and Drive root: inverse of the Company A test.
- Driver evidence files/folders: restricted; a driver must not open another driver's or another delivery's file by guessing/pasting a Drive ID or URL.
- AppSheet app access: an unauthorised signed-in identity must not open the app; Company A and Company B test identities must not sync or retrieve each other's rows.
- Alternate paths: test Google Sheets/Drive UI, direct file URL/ID, export/download, AppSheet deep links, row-key manipulation, sync/API paths available to the app, and stale offline data after access revocation.

A separate workbook per company is not sufficient if Drive sharing accidentally grants broad access. Conversely, a private workbook is not sufficient if a shared app exposes rows through a creator-owned data connection and incorrect security filters. Both boundaries must be tested.

## 6. Automated tests and real-environment tests

### Can be tested in GitHub CI without Google access

- Role action allow/deny contract stays aligned with src/core/permissions.js.
- Company A actor cannot access a Company B tenant context and vice versa.
- Missing, inactive, malformed or unknown roles fail closed.
- Platform administrator identity is not inferred from company membership; company roles cannot invoke platform-only actions.
- Driver role cannot use dispatcher/company-admin actions through the permission helper.
- Static checks ensure the AppSheet design explicitly requires sign-in, per-company source separation, driver assignment filters, and states that slices/hidden controls are not security boundaries.

These tests demonstrate application contract behavior only; they do not prove AppSheet expressions, Google Drive ACLs, or Sheets permissions.

### Requires an owner-authorized real non-production Google environment

Use named synthetic identities, e.g. platform.admin.test, company.a.admin.test, company.a.dispatch.test, company.a.driver.test, company.b.admin.test, company.b.dispatch.test, company.b.driver.test. Replace these labels with actual controlled test accounts only in the authorized environment; do not paste passwords or secrets into GitHub/chat.

For each identity, verify sign-in and allow-list behavior; app visibility; initial sync; list/search/deep-link access; create/update/delete attempts; direct workbook and Drive access; file export/download; evidence URLs/IDs; switching accounts; access revocation; offline cache; audit logs; and AppSheet automation execution identity. Test both positive access within scope and negative access outside it. Record date, app version, source IDs in a protected audit record, result, and screenshot/log evidence with personal data redacted.

**Not currently verified:** no AppSheet app has been created or published; no live Google identity, workbook ACL, Drive ACL, AppSheet security filter, licence, sync or direct-access test was run.

## 7. Acceptance and release gate

Do not close FVK-01, FVK-02 or the new FVK-APP-SEC-01 based on this document or CI alone. The target is:

1. Synthetic CI tests pass on the exact commit.
2. Code review confirms backend action checks and driver resource binding.
3. A separately authorized non-production Google test environment is configured with the named synthetic identities.
4. All direct-source and AppSheet positive/negative isolation tests pass, including Company A ↔ Company B.
5. Evidence access and access revocation are tested.
6. No secrets are exposed; licence and policy review is complete.
7. Owner explicitly approves any later app creation/publication or paid activation.

**Current decision: NO-GO for live AppSheet operations.** Keep src/Code.js fail-closed and do not publish an app.

## 8. Official AppSheet references

- [Security: The Essentials](https://support.google.com/appsheet/answer/10105078?hl=en): sign-in, application access and data-source protection.
- [Security filters: The Essentials](https://support.google.com/appsheet/answer/10104488?hl=en): row filters and limits.
- [Set access mode as app creator or app user](https://support.google.com/appsheet/answer/10105756?hl=en): source access mode and warning that app-connected data may be exposed through the app.
- [About licensing for organizations](https://support.google.com/appsheet/answer/16563370?hl=en): current organization licensing options and access restrictions.

Re-check official documentation and the actual account's licensing/security settings before configuration; this document is not an entitlement determination.
