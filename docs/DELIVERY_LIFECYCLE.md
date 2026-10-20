# Delivery lifecycle, driver offers and notification outbox

## Existing approved state model reconciled

This implementation uses the transitions already defined in `src/core/stateMachine.js`; it adds no delivery states.

| Action | From | To | Authorized roles |
|---|---|---|---|
| `VALIDATE_OK` | `RECEIVED` | `READY_FOR_QUOTE` | SYSTEM, DISPATCHER |
| `VALIDATE_FAIL` | `RECEIVED` | `VALIDATION_FAILED` | SYSTEM, DISPATCHER |
| `ISSUE_QUOTE` | `READY_FOR_QUOTE`, `QUOTE_REJECTED`, `QUOTE_EXPIRED` | `QUOTE_ISSUED` | DISPATCHER, COMPANY_ADMIN |
| `ACCEPT_QUOTE` | `QUOTE_ISSUED` | `DISPATCH_PENDING` | DISPATCHER, SYSTEM |
| `REJECT_QUOTE` | `QUOTE_ISSUED` | `QUOTE_REJECTED` | DISPATCHER, SYSTEM |
| `EXPIRE_QUOTE` | `QUOTE_ISSUED` | `QUOTE_EXPIRED` | SYSTEM |
| `OFFER_TO_DRIVER` | `DISPATCH_PENDING` | `OFFER_SENT` | SYSTEM, DISPATCHER |
| `ACCEPT_OFFER` | `OFFER_SENT` | `ASSIGNED` | DRIVER |
| `DECLINE_OFFER`, `EXPIRE_OFFER` | `OFFER_SENT` | `DISPATCH_PENDING` | DRIVER, SYSTEM |
| `CONFIRM_COLLECTION` | `ASSIGNED` | `COLLECTED` | DRIVER |
| `START_TRANSIT` | `COLLECTED` | `IN_TRANSIT` | DRIVER |
| `FAIL_DELIVERY` | `IN_TRANSIT` | `DELIVERY_ATTEMPTED` | DRIVER, SYSTEM |
| `REOFFER` | `DELIVERY_ATTEMPTED` | `DISPATCH_PENDING` | DISPATCHER |
| `CANCEL` | `RECEIVED` | `CANCELLED` | DISPATCHER, COMPANY_ADMIN |

The existing state machine also contains `ATTEMPT_DELIVERY`, `VERIFY_OTP`, and `CLOSE` transitions. This change deliberately stops at `IN_TRANSIT` and does not implement or extend proof-of-delivery. Cancellation remains limited to `RECEIVED`; cancellation after dispatch is rejected rather than inventing a new transition.

## Durable offer rules

- `DriverOffers` stores an offer ID, company/delivery/driver binding, status, expiry, creation/response times, responding actor, idempotency request key and attempt number.
- An offer is created only for a `DISPATCH_PENDING` delivery and an active driver registered to the same company.
- One `OFFERED` offer is allowed per delivery at a time. Accept/decline requests must come from the offered driver; after assignment, collection/transit actions must come from the assigned driver.
- Offer creation, response and expiry use the same store-level exclusive lock as delivery transitions. Delivery transition idempotency keys are deterministic per offer/action.
- Expiry is deterministic at `now >= expires_at`. A SYSTEM actor must run expiry processing; after `EXPIRE_OFFER`, the delivery returns to `DISPATCH_PENDING` and dispatch may issue a new offer.
- A persisted offer is the source of truth. A message or outbox status does not grant assignment.
- If the lifecycle transition commits but the offer status write fails, retry reconciles the persisted offer from the committed delivery state. If offer creation persists but the transition fails, retry resumes the same offer instead of creating a second one.

## Durable notifications

- `NotificationOutbox` stores stable notification IDs, company/delivery/event references, recipient actor, channel, template, payload, status, attempts, next-attempt time, processing lease, safe error code, provider message ID and timestamps.
- State transition events enqueue an internal `DELIVERY_STATE_CHANGED` record during the same recoverable transition path. Driver offers enqueue a separate `DRIVER_OFFER` notification.
- The worker claims due records under a lock, uses bounded exponential backoff (at most five attempts and a capped delay), and recovers expired processing leases.
- Provider acceptance is recorded as `SENT_TO_PROVIDER`, not `DELIVERY_CONFIRMED`. A verified provider delivery callback must call the status-recording method before the record becomes `DELIVERY_CONFIRMED`.
- Sender adapters receive the stable notification ID as an idempotency key. If the selected provider does not support idempotent sends, a timeout after provider acceptance can still cause a duplicate external message; this remains an integration risk.
- No live WhatsApp sender, webhook, or provider credentials are configured by this change.

## Evidence boundaries

Node.js tests use synthetic data and fake stores/senders. They exercise the actual delivery, dispatch and outbox application logic, but they do not prove real Google Sheets locking, trigger scheduling, quota behavior, Drive/AppSheet permissions, or provider delivery. The Google workbook initializer creates the new tabs for an existing schema-v2 workbook if they are absent, and fails closed on incompatible existing headers. Real Google integration remains unverified.

Proof-of-delivery implementation is explicitly out of scope for this stage.

## Trusted SYSTEM actor boundary

The existing state machine requires role `SYSTEM` for quote/offer expiry actions. Company membership resolution intentionally does not allow a user to self-assign this role. `createTrustedActorResolver` now exposes `resolveSystemActor`, which only brands a SYSTEM actor when an injected `getAuthenticatedSystemPrincipal` callback returns a non-empty principal. That callback must validate the actual internal scheduled invocation; it must not read request fields or be a permissive constant. This repository has no live scheduled-job identity provider configured, so expiry is mock-tested with an injected synthetic principal and is not production-operational yet.
