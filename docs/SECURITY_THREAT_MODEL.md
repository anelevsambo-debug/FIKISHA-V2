# Security threat model (preliminary)

| Threat | Control | Residual risk |
|---|---|---|
| Cross-company workbook/app misbinding | Separate workbook, folder and app; company_id validation; isolation gate | Human misconfiguration remains |
| Developer account access | DPA, hardened account, break-glass logging | Central script owner can open all company workbooks; dashboard cannot prevent it |
| Direct source edits | Restrict workbook editors; integrity checks planned | Sheets logs are not tamper-proof; admins can edit records |
| OTP theft/replay | Hash, salt, pepper, expiry and attempt limit planned | End-to-end OTP not implemented yet |
| Webhook spoofing | Keep live webhook disabled; test header access; consider signature-verifying relay | Secret URL is not equivalent to HMAC verification |
| Data loss | Backups and restore drill planned | Not verified |

A central Apps Script project requires its developer account to access all company workbooks. Dashboards do not technically prevent direct access. Written DPA, break-glass process and stronger deployment/database options are mandatory owner decisions. Sheets logs are not tamper-proof.
