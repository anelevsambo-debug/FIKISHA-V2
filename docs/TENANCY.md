# Tenant isolation — implementation and limits

Each company is intended to have a separate operational workbook, Drive evidence folder and Company Admin AppSheet app. Platform metadata should remain separate from delivery records.

The delivery service rejects caller-created actor objects and checks active membership, company ID and role through the trusted actor resolver contract. The platform registry adapter reads company membership from a controlled CompanyMembers sheet and rejects duplicate membership records. Platform-wide provisioning uses a separate PlatformAdmins registry and requires a resolver-branded platform-admin actor; a company-admin actor is not sufficient. The Sheets adapter is constructed with a specific workbook ID rather than accepting an arbitrary workbook ID from a request. The real identity provider and live platform workbook are not connected or verified.

No live Google accounts, company workbooks or AppSheet apps have been provisioned and tested. Code-level checks do not establish live tenant isolation. The central Apps Script owner can still access all workbooks shared with that account.

Before launch:
1. Resolve company identity from authenticated membership records, never from an untrusted client field.
2. Keep workbook IDs in platform-controlled configuration.
3. Test Company A against Company B delivery IDs and evidence links using separate real accounts.
4. Do not rely on AppSheet slices or hidden views as the security boundary.
5. Restrict direct workbook sharing and review privileged access.
6. Keep real customer data out until cross-tenant tests pass.

Current status: NOT LIVE-VERIFIED; NO-GO for real customer data.

## P0-02 engineering continuation — 2026-10-20

The new `resolveTenantResources(companyId, actor, deps)` path in `src/core/tenants.js` requires a resolver-branded active actor whose company matches the requested company. It loads the company record from the server-controlled platform registry and obtains workbook/folder IDs only from that record. It rejects missing resource bindings, inactive companies, registry errors, foreign Drive folder/workbook markers, a mismatched CompanyConfig company ID, and schema versions other than 2. It does not accept caller-supplied resource IDs. The Sheets store is constructed with the registry's workbook ID.

The Sheets adapter now rejects duplicate delivery IDs instead of selecting the first matching row. It rejects a delivery ID already bound to another company and refuses to save a row if the stored company differs from the update's company. The delivery service tests additionally exercise Company B attempting to read or transition a Company A delivery and using Company B proof evidence against a Company A delivery.

Provisioning now requires the Companies registry result to match the requested company ID and have status `ACTIVE`; it rejects a provisioning job bound to another company. Existing deterministic resource names, company/resource markers, duplicate detection, and job-based retry recovery remain in place.

### Google resource ACL boundary

These checks verify logical binding only. No real Google test workspace, company workbooks, Drive folders, or separate test accounts were available for this task. This branch does not yet verify or enforce per-company Google Drive/Sheets ACLs. The central Apps Script owner can access resources shared with that account, and Drive description markers are integrity checks, not access-control lists. Before any real customer use, test direct workbook and folder access as Company A and Company B users, verify editor/viewer sharing settings, and confirm unauthorized accounts cannot open the other tenant's resources directly.

Status: logical isolation is strengthened and mock-tested; live Google resource isolation remains UNKNOWN / NOT VERIFIED. No production permissions or customer data were changed.
