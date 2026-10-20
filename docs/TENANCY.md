# Tenant isolation — implementation and limits

Each company is intended to have a separate operational workbook, Drive evidence folder and Company Admin AppSheet app. Platform metadata should remain separate from delivery records.

The delivery service rejects caller-created actor objects and checks active membership, company ID and role through the trusted actor resolver contract. The platform registry adapter reads company membership from a controlled CompanyMembers sheet and rejects duplicate membership records. The Sheets adapter is constructed with a specific workbook ID rather than accepting an arbitrary workbook ID from a request. The real identity provider and live platform workbook are not connected or verified.

No live Google accounts, company workbooks or AppSheet apps have been provisioned and tested. Code-level checks do not establish live tenant isolation. The central Apps Script owner can still access all workbooks shared with that account.

Before launch:
1. Resolve company identity from authenticated membership records, never from an untrusted client field.
2. Keep workbook IDs in platform-controlled configuration.
3. Test Company A against Company B delivery IDs and evidence links using separate real accounts.
4. Do not rely on AppSheet slices or hidden views as the security boundary.
5. Restrict direct workbook sharing and review privileged access.
6. Keep real customer data out until cross-tenant tests pass.

Current status: NOT LIVE-VERIFIED; NO-GO for real customer data.
