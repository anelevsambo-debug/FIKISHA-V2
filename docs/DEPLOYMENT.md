# Deployment status and procedure

## Current status
No Google Apps Script deployment, workbook provisioning, AppSheet creation, or live WhatsApp configuration has been performed. The current doPost handler is a placeholder. Do not publish it as a live webhook.

## Prerequisites
- A Google account authorized to create and administer the required Apps Script project, Drive folder, and Sheets.
- A Google Cloud project if required by the selected Apps Script/API configuration.
- Permission to authorize the declared Apps Script scopes.
- An approved AppSheet plan for the intended users.
- A Meta WhatsApp Business account, phone-number ID, access token and approved message templates if WhatsApp is enabled.
- A secure place to store credentials; never use source code, workbook cells or public GitHub secrets in plain text.

## Controlled deployment sequence
1. Create a non-production Apps Script project under an approved owner account.
2. Copy the reviewed source files into the project using the Apps Script editor or a separately verified deployment workflow.
3. Configure Script Properties and authorize only the required scopes.
4. Create a disposable test workbook with exact headers in DATA_MODEL.md.
5. Run non-production unit/adapter smoke tests and inspect the logs for accidental sensitive data.
6. Deploy only a restricted test web app and verify its execution identity and access settings.
7. Do not enable delivery actions until server-side authentication and membership resolution are connected.
8. Do not configure WhatsApp webhooks until signature verification and duplicate/replay handling are implemented.
9. Test a full delivery workflow with synthetic records and two separate company accounts.
10. Test backup restoration and rollback before considering a pilot.

## Deployment limitation
The repository does not yet contain a verified, reproducible Apps Script bundle or authenticated web endpoint. Copying the current files into Apps Script will not create a complete usable service. Deployment remains blocked until the missing runtime wiring and security gates are implemented.
