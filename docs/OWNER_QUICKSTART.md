# Owner Quickstart — safe current status

## What is ready now
The repository contains partial delivery-service code, a Google Sheets adapter, an outbound Meta WhatsApp adapter, unit tests and initial operating/security documents. This is not yet a usable live application.

## What you should do
1. Open the [draft pull request](https://github.com/anelevsambo-debug/FIKISHA-V2/pull/1) and review its Files changed tab.
2. Open the Checks tab and inspect the latest FIKISHA-V2 CI run. A test pass does not mean a live deployment works.
3. Keep the pull request unmerged until the remaining application, security and integration work is complete.
4. Do not enter real customer data into the repository or test workbook.
5. Do not deploy the current Apps Script doPost handler as a WhatsApp webhook; it deliberately returns WEBHOOK_NOT_CONFIGURED.
6. Do not buy AppSheet, Workspace, hosting or messaging services until the cost and licensing requirements have been verified and you approve them.

## Before a real pilot
A trusted authorized helper will need to complete the authenticated API, company provisioning, AppSheet apps and permissions, inbound WhatsApp signature verification, consent/opt-out workflow, recovery/backups, live two-company isolation tests and a controlled deployment. Follow docs/DEPLOYMENT.md only after those blockers are resolved.

## Protect your accounts
- Never post access tokens, passwords, OAuth credentials or webhook secrets in GitHub or chat.
- Use only Google accounts you are authorized to administer.
- Do not bypass University computer restrictions.
- Keep the system disabled for real customer operations until every mandatory item in docs/GO_NO_GO.md has evidence.

If an action requires Google account access, provider credentials or paid service approval, the code cannot perform it on your behalf without that authorization.
