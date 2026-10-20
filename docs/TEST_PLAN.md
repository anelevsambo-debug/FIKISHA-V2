# Test plan

The repository has core unit tests, delivery service tests using an isolated test store, and a static scan for prohibited legacy/blockchain terms.

These tests exercise code in Node.js. They do not prove Apps Script runtime compatibility, live Sheets permissions, AppSheet access controls, Meta API delivery, webhook security or production concurrency.

Required before launch:
1. Apps Script runtime smoke test with a non-production workbook.
2. Sheets adapter tests with exact required sheets and headers.
3. Two-company isolation tests using distinct real accounts.
4. Concurrent duplicate-request and partial-write recovery tests.
5. Meta API integration with approved templates in a test business account.
6. Webhook authenticity, replay and duplicate-event tests.
7. AppSheet sign-in, security-filter and action authorization tests.
8. Backup restoration and incident-recovery exercise.
