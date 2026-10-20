# Data model and persistence contract

## Implementation boundary
The branch includes a Sheets persistence adapter and delivery service, but no live Google workbook has been provisioned or tested. A company workbook must have the exact sheet names and headers below before the adapter can operate. Missing sheets or mismatched headers fail closed.

## Required company workbook sheets
- Deliveries: delivery_id, company_id, status, sender_name, sender_phone, recipient_name, recipient_phone, pickup_text, dropoff_text, instructions, consent_status, created_at, updated_at, created_by, version, driver_id, proof_id, delivered_at, failure_reason
- DeliveryEvents: event_id, company_id, delivery_id, event_type, actor_id, from_status, to_status, reason, proof_id, created_at
- Idempotency: key, result_json, created_at
- ProofOfDelivery: proof_id, delivery_id, company_id, verified, created_at
- Drivers: driver_id, company_id, status

Headers must occupy row 1 exactly. The adapter does not provision missing sheets.

## Invariants
- Every delivery has a stable ID and company ID.
- The service checks actor activity, role and matching company ID.
- State transitions are checked against the state machine.
- Completion requires an existing verified proof record matching delivery and company.
- Assignment requires an active driver in the same company.
- Create retries use a company-scoped idempotency key.
- Events are append-only by application convention.
- Version is checked before updates.

## Known limitations
Google Sheets does not provide relational transactions. Delivery writes, event writes, and idempotency writes are separate operations. The current idempotency lookup and insert are not an atomic reservation, and the Sheets adapter needs real concurrency tests. A production release requires a stronger transaction design or explicit reconciliation and tested recovery.
