# Secure WhatsApp Integration — Ingress, Consent, Outbox and Status

**Status:** IMPLEMENTED IN CANDIDATE; mocked tests and CI pending. **Not live verified.**
**Release gate:** outbound disabled until owner-authorized non-production runtime and provider-sandbox verification pass.
**Scope:** WhatsApp Cloud API service messages only. Marketing remains disabled.

## Official provider requirements reviewed

Meta's WhatsApp Business Platform documentation describes webhook notifications for inbound messages and outbound-message status changes, and requires a reachable HTTPS callback. Meta's archived Node.js SDK documentation describes GET subscription verification with the configured verification token and POST authenticity validation using `X-Hub-Signature-256` calculated with the app secret. Treat the official current documentation and app settings as authoritative at deployment time; SDK documentation is archived:
- [Meta WhatsApp Cloud API collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api)
- [Meta webhook payload reference](https://www.postman.com/meta/whatsapp-business-platform/folder/tduohwq/webhook-payload-reference)
- [Meta archived Node.js SDK webhook signature notes](https://github.com/WhatsApp/WhatsApp-Nodejs-SDK/blob/main/website/docs/api-reference/webhooks/start.md)

## Ingress boundary

- `src/Code.js` remains a fail-closed placeholder; `doPost` is not an operational webhook and must remain disabled.
- `src/notifications/whatsappIntegration.js` accepts raw request content and requires an injected signature verifier. The verifier must calculate HMAC-SHA-256 over the **exact raw request bytes** with the server-only Meta app secret and compare the signature safely. No permissive verifier/fallback is allowed.
- Do not parse or reserialize JSON before signature verification.
- This repository is Google Apps-first. Apps Script's web-app event object does not, by itself, establish a byte-preserving HTTP ingress contract. Therefore the actual ingress should be a small HTTPS gateway/runtime that preserves raw bytes and validates the Meta signature, then passes only verified, bounded events into trusted internal processing. The gateway's identity, transport protection and deployment configuration must be independently reviewed. Do not proxy unauthenticated payloads into Apps Script.
- GET subscription verification, if ever deployed, must compare the configured verification token safely and return only the supplied challenge on a valid request. It is not a substitute for POST signature verification.
- WABA ID and phone-number ID are allow-listed server-side. Company/role/tenant authority is never taken from webhook body fields.
- Durable event keys use provider message/event identity plus event kind/status/timestamp where applicable. The persistence adapter must enforce uniqueness atomically and durably. A duplicate event is safe to acknowledge only after the original event is durably recorded; failed status processing must be recoverable on provider retry.
- Webhook delivery may be retried and duplicated by the provider; return success only after verified event persistence. Avoid logging payloads, phone numbers, signature values, message bodies or secrets.

## Outbound boundary

- Outbound sending is disabled unless the integration is explicitly enabled by server-side configuration; this candidate has no live sender credentials.
- A queued record is not permission to send. Immediately before every provider submission, recheck current opt-in and suppression for the normalized destination and exact purpose. Missing, ambiguous, revoked or unavailable consent fails closed. Recheck after claiming the queue item to reduce opt-out/send races; the eventual production adapter must serialize suppression and send authorization strongly enough to prevent a concurrent opt-out from being bypassed.
- Marketing purpose is hard-blocked. Service messages require an approved purpose-specific template in a server-side allowlist. Template approval must be confirmed in the real WABA before use.
- Validate destination E.164 format. The sender must build provider requests from a typed allow-listed template payload, not arbitrary user-controlled text or a caller-provided company ID.
- Retry only known transient failures, with a bounded attempt count, exponential backoff and provider rate-limit handling. Permanent destination/template/permission errors fail without retries.
- A timeout after the provider may have accepted a send is **OUTCOME_UNKNOWN**, not an automatic retry. Reconcile by provider message ID/status or a separately authorized provider lookup to avoid duplicate messages.
- Provider API acceptance means only `SENT_TO_PROVIDER`, never delivered/read. Delivered/read/failed are applied only from authenticated, deduplicated provider status events. Out-of-order events must not downgrade status; unmatched status events must be retained for reconciliation.
- Logs contain only component/event and bounded error codes. Do not log bearer tokens, app secrets, raw payloads, phone numbers, OTPs or message content.

## State and storage contract for production adapter

Use the existing `NotificationOutbox` and add a dedicated durable provider-event ledger (schema change only in a separately reviewed implementation step). The production store must provide:
- unique durable webhook-event insertion with atomic uniqueness;
- event processing/recovery state so a crash after insert but before status update can be resumed;
- unique provider message ID correlation to the outbox record;
- conditional, monotonic status updates and an unmatched-status reconciliation queue;
- notification claim leases, bounded retries and a terminal `OUTCOME_UNKNOWN` state;
- purpose-scoped consent ledger and durable suppression history;
- server-side-only credentials in a secret manager, never in Sheets, AppSheet, source, logs or chat.

The candidate currently relies on injected store methods and does not add the provider-event ledger to the workbook schema. It is not yet an end-to-end durable implementation.

## Credentials/configuration prerequisites (never paste secrets into chat)

Store/configure these only in the chosen host's secret manager or protected deployment settings:
- Meta App Secret (webhook HMAC validation);
- webhook verification token (GET challenge verification only);
- access token with minimum required permissions;
- WhatsApp Business Account ID (WABA ID);
- registered phone-number ID;
- pinned supported Graph API version;
- approved template names/languages and parameter schema;
- allow-listed WABA/phone-number IDs and environment-specific enable flag;
- protected store credentials / Google service identity for the selected deployment architecture.

Record names and where they are stored, not secret values. Rotate credentials if exposed. Do not request secrets in chat.

## Test evidence and limits

The candidate test file uses synthetic payloads and injected fake signature, consent, sender and persistence adapters. It is designed to cover invalid/missing signature, malformed body, duplicate/replayed event, out-of-order status, persistence failure, opt-out before queued send, missing consent, invalid destination, unapproved template, marketing block, rate/transient failure, timeout after provider acceptance, retry exhaustion and outbound-disabled behavior.

These are **mocked Node tests**, not a Meta sandbox test. They do not verify the real HMAC adapter, exact raw-byte behavior of the hosting gateway, real provider response/status shapes, actual template approvals, live Google locking/persistence or consent/send concurrency. No real messages, real recipient data or credentials are used. CI must run on the exact candidate code head.

## Release gate — NO-GO

Do not activate `doPost`, deploy a gateway, set the outbound enable flag, send real messages or mark FVK-04/FVK-06/FVK-17 closed until:
1. a raw-byte-preserving HTTPS ingress is selected and independently reviewed;
2. real HMAC verification, GET verification, provider context allow-listing, durable dedupe and replay/recovery are verified in an authorized isolated environment;
3. durable consent/suppression and send-time enforcement are implemented and race-tested;
4. approved templates, Graph API version, token permissions, rate limits and status payloads are checked against the current Meta configuration;
5. the exact build passes CI and a separately authorized Meta test-number/provider-sandbox test with no production recipients;
6. Botswana privacy/legal review and current Meta policy review are complete; assess Eswatini separately before expansion.

Until then, keep live messaging disabled and continue safe non-messaging engineering.
