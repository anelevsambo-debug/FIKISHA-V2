# Architecture decisions

- ADR-001: Google Apps-first, with Apps Script as intended sole state-transition authority.
- ADR-002: Separate company workbook, evidence folder and Company Admin app per tenant; no shared multi-company workbook.
- ADR-003: Central Apps Script registry is a pilot default only. Its owner account must access all workbooks, so dashboards do not prevent developer direct access. DPA and break-glass logging required; per-company deployments/database are upgrade paths.
- ADR-004: Live WhatsApp disabled until account, consent, templates, pricing and sandbox gates pass.
- ADR-005: Sheets is a conditional pilot store, not transactional or tamper-proof.
- ADR-006: No production deployment or external account setup is performed by this build.
