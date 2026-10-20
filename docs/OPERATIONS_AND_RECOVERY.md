# Operations and recovery

No production environment has been deployed. Do not use the current Apps Script entry point for live deliveries or WhatsApp webhooks.

Failure cases to handle before launch:
- Delivery saved but event append fails.
- Event saved but notification fails.
- Duplicate idempotency keys arrive concurrently.
- A version conflict occurs during a status update.
- A provider accepts a message but the response is lost.
- A webhook is delivered repeatedly.
- Workbook schema is changed manually.
- Company provisioning stops partway through.
- A driver is suspended while an assignment is active.

The Sheets adapter uses LockService for append/update operations and checks a record version before updates. It does not provide cross-sheet transactions. The idempotency lookup and write are not an atomic reservation. These are pre-launch blockers.

Required recovery design: record safe failure metadata; retry only operations safe to repeat; reconcile deliveries against events; deduplicate provider events by provider event ID; track retry count and terminal failures; back up company workbooks; restore into a separate workbook during a documented exercise; audit recovery actions.
