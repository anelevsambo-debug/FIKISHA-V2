# Data model and persistence contract

## Implementation boundary
The branch includes a Sheets persistence adapter and delivery service, but no live Google workbook has been provisioned or tested. A company workbook must have the exact sheet names and headers below before the adapter can operate. Missing sheets or mismatched headers fail closed.

## Required company workbook sheets
- Deliveries: delivery_id, company_id, status, sender_name, sender_phone, recipient_name, recipient_phone, pickup_text, dropoff_text, instructions, consent_status, created_at, updated_at, created_by, version, last_operation_id, driver_id, proof_id, delivered_at, failure_reason
- DeliveryEvents: event_id, company_id, delivery_id, event_type, actor_id, from_status, to_status, reason, proof_id, created_at
- Idempotency: key, result_json, created_at
- ProofOfDelivery: proof_id, delivery_id, company_id, verified, created_at
- Drivers: driver_id, company_id, status

Headers must occupy row 1 exactly. The adapter does not provision missing sheets. Company workbook schema version is 2; version-1 workbooks fail closed and require a reviewed migration rather than automatic header changes.

## Invariants
- Every delivery has a stable ID and company ID.
- Delivery service operations require an actor object minted by the trusted actor resolver; caller-created actor objects are rejected.
- The resolver checks the authenticated email returned by an injected identity provider against an active company membership record and verifies that the requested company matches the membership.
- The injected identity provider must read a trusted authentication boundary; it must not simply return an email or actor field from an untrusted request.
- No real authentication provider or platform membership-store adapter is connected yet, and the public Apps Script entrypoint remains disabled. Therefore, the resolver contract is not proof of end-to-end authentication.
- State transitions are checked against the state machine.
- Completion requires an existing verified proof record matching delivery and company.
- Assignment requires an active driver in the same company.
- Create requests use a company-scoped idempotency key.
- Event rows are append-only by application convention.
- Delivery version is checked before transition updates.

## Create-operation idempotency and recovery

The Sheets adapter implements a script-lock-protected reservation for a company-scoped idempotency key. The reservation stores an operation state and intended delivery/event payload in the existing `result_json` cell, without changing the sheet header schema.

The create flow is:
1. Reserve the key as `IN_PROGRESS` under a script lock, or load the existing reservation.
2. Ensure the delivery row exists with the reserved delivery ID.
3. Ensure the creation event exists with the reserved event ID.
4. Mark the reservation `COMPLETED` and retain the original creation timestamp.

If a write fails after the reservation is stored, a retry with the same key resumes the same operation rather than creating a new delivery or event. Legacy completed idempotency rows from the earlier record shape remain readable.

Unit tests cover reservation reuse, event/delivery duplicate protection, and recovery after a simulated event-write failure. The adapter tests use fake Sheets and a fake lock; they do not prove actual Google Apps Script lock behavior or real concurrent execution.

## Known limitations

Google Sheets does not provide relational transactions. A script lock makes each protected operation's read/check/write sequence mutually exclusive within the same Apps Script project, but does not turn delivery, event and idempotency records into one transaction. The create flow has a recoverable reservation. Transition requests now require a company-scoped idempotency key and record a last_operation_id marker on the delivery row; a retry can finish the audit event after a partial write without applying the state change twice. This still does not create a transaction spanning the delivery, event and idempotency records. The new transition-recovery path is unit-tested with fakes; actual Apps Script lock behavior and real concurrent Google Sheets execution remain unverified.
