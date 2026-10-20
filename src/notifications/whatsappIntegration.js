/**
 * WhatsApp Cloud API integration policy boundary.
 *
 * This module intentionally does not expose an HTTP handler. The hosting adapter
 * must provide the exact raw request bytes and a Meta X-Hub-Signature-256 verifier.
 * Apps Script doPost is not an approved ingress until raw-byte signature verification
 * and authenticated runtime behavior are proven for the actual deployment model.
 */
function createWhatsAppIntegration(deps) {
  if (!deps || !deps.store || !deps.clock ||
      typeof deps.verifySignature !== "function" ||
      typeof deps.consentGate !== "function" ||
      typeof deps.sender !== "function" ||
      typeof deps.isTemplateApproved !== "function" ||
      typeof deps.isAllowedProviderContext !== "function") {
    throw new FikishaError("WHATSAPP_SECURITY_DEPENDENCIES_REQUIRED");
  }
  var store = deps.store;
  var maxAttempts = Math.max(1, Math.min(Number(deps.maxAttempts || 5), 5));
  var log = typeof deps.logger === "function" ? deps.logger : function () {};
  var enabled = deps.enabled === true;
  function fail(code) { throw new FikishaError(code); }
  function safeLog(event, code) {
    try { log({ component: "whatsapp_integration", event: event, code: code }); } catch (ignored) {}
  }
  function validId(v) { return typeof v === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(v); }
  function parseRaw(raw) {
    if (!(typeof raw === "string" || (raw && typeof raw.toString === "function"))) fail("WEBHOOK_RAW_BODY_REQUIRED");
    var text = typeof raw === "string" ? raw : raw.toString("utf8");
    if (!text || text.length > 3000000) fail("WEBHOOK_BODY_INVALID");
    try { return JSON.parse(text); } catch (e) { fail("WEBHOOK_JSON_INVALID"); }
  }
  function statusRank(s) { return ({ accepted: 1, sent: 1, delivered: 2, read: 3 })[s] || 0; }
  function validateStatus(s) {
    return ["sent", "delivered", "read", "failed"].includes(s);
  }
  function eventKey(event) {
    if (event && event.id && validId(event.id)) return "provider-event:" + event.id;
    if (event && event.message_id && validId(event.message_id) && validateStatus(event.status)) {
      return "message-status:" + event.message_id + ":" + event.status + ":" + String(event.timestamp || "");
    }
    if (event && event.message_id && validId(event.message_id) && event.kind === "inbound") return "inbound-message:" + event.message_id;
    fail("WEBHOOK_EVENT_IDENTITY_MISSING");
  }
  function normalizeWebhook(payload) {
    if (!payload || payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry) || !payload.entry.length) {
      fail("WEBHOOK_PAYLOAD_INVALID");
    }
    var events = [];
    payload.entry.forEach(function(entry) {
      if (!entry || !validId(entry.id) || !Array.isArray(entry.changes)) fail("WEBHOOK_ENTRY_INVALID");
      entry.changes.forEach(function(change) {
        if (!change || change.field !== "messages" || !change.value ||
            !deps.isAllowedProviderContext(entry.id, change.value.metadata || {})) fail("WEBHOOK_PROVIDER_CONTEXT_INVALID");
        var value = change.value;
        (value.messages || []).forEach(function(m) {
          if (!m || !validId(m.id) || typeof m.from !== "string" || !/^\+[1-9][0-9]{7,14}$/.test("+" + String(m.from).replace(/^\+/, ""))) {
            fail("WEBHOOK_MESSAGE_INVALID");
          }
          events.push({ kind: "inbound", message_id: m.id, sender_fingerprint: deps.fingerprintPhone ? deps.fingerprintPhone(m.from) : "", timestamp: m.timestamp || "", provider_account_id: entry.id });
        });
        (value.statuses || []).forEach(function(s) {
          if (!s || !validId(s.id) || !validateStatus(s.status) || !/^\d+$/.test(String(s.timestamp || ""))) fail("WEBHOOK_STATUS_INVALID");
          events.push({ kind: "status", message_id: s.id, status: s.status, timestamp: String(s.timestamp), recipient_fingerprint: deps.fingerprintPhone ? deps.fingerprintPhone(s.recipient_id || "") : "", errors: Array.isArray(s.errors) ? s.errors.map(function(e){return {code:String(e.code || "")};}) : [] });
        });
      });
    });
    if (!events.length) fail("WEBHOOK_NO_SUPPORTED_EVENTS");
    return events;
  }
  function receiveWebhook(rawBody, signatureHeader) {
    if (typeof deps.verifySignature !== "function" || !rawBody || typeof signatureHeader !== "string" || !signatureHeader) fail("WEBHOOK_AUTH_MATERIAL_MISSING");
    var valid = false;
    try { valid = deps.verifySignature(rawBody, signatureHeader) === true; } catch (ignored) { valid = false; }
    if (!valid) { safeLog("signature_rejected", "WEBHOOK_SIGNATURE_INVALID"); fail("WEBHOOK_SIGNATURE_INVALID"); }
    var payload = parseRaw(rawBody);
    var events = normalizeWebhook(payload);
    var results = [];
    events.forEach(function(event) {
      var key = eventKey(event);
      // The store must enforce uniqueness under a durable lock/transaction. A check-then-insert
      // implementation without atomic uniqueness is not sufficient for concurrent deliveries.
      var result = store.recordWebhookEventUnique(key, event);
      if (!result || !["CREATED", "DUPLICATE"].includes(result.status)) fail("WEBHOOK_EVENT_PERSISTENCE_FAILED");
      if (result.status === "CREATED" && event.kind === "status") applyStatusEvent(event);
      results.push({ event_key: key, status: result.status });
    });
    safeLog("webhook_accepted", "WEBHOOK_EVENTS_RECORDED");
    return { ok: true, received: results.length, duplicates: results.filter(function(r){return r.status === "DUPLICATE";}).length };
  }
  function applyStatusEvent(event) {
    var notification = store.getNotificationByProviderMessageId(event.message_id);
    if (!notification) {
      // Persist unmatched statuses for later reconciliation; never infer a delivery.
      store.recordUnmatchedProviderStatus(event);
      return;
    }
    var current = notification.provider_status || "sent";
    if (current === "failed" || current === "read") return;
    if (event.status === "failed") {
      if (current !== "delivered" && current !== "read") store.applyProviderStatus(notification.notification_id, event.message_id, "failed", event.timestamp, event.errors);
      return;
    }
    if (statusRank(event.status) <= statusRank(current)) return;
    store.applyProviderStatus(notification.notification_id, event.message_id, event.status, event.timestamp, event.errors);
  }
  function sendQueued(notificationId, nowIso) {
    if (!enabled) fail("WHATSAPP_OUTBOUND_DISABLED");
    if (!validId(notificationId)) fail("NOTIFICATION_ID_INVALID");
    var item = store.getNotification(notificationId);
    if (!item) fail("NOTIFICATION_NOT_FOUND");
    if (!["PENDING", "RETRY"].includes(item.status)) fail("NOTIFICATION_NOT_ELIGIBLE");
    if (Number(item.attempt_count || 0) >= maxAttempts) {
      store.markNotificationFailed(notificationId, "RETRY_EXHAUSTED");
      fail("RETRY_EXHAUSTED");
    }
    var message;
    try { message = JSON.parse(item.payload_json || "{}"); } catch (e) { fail("NOTIFICATION_PAYLOAD_INVALID"); }
    var to = message.to;
    if (typeof to !== "string" || !/^\+[1-9][0-9]{7,14}$/.test(to)) {
      store.markNotificationFailed(notificationId, "INVALID_DESTINATION");
      fail("INVALID_DESTINATION");
    }
    if (message.purpose === "MARKETING") {
      store.markNotificationFailed(notificationId, "MARKETING_DISABLED");
      fail("MARKETING_DISABLED");
    }
    if (!message.purpose || !deps.consentGate(to, message.purpose, nowIso || deps.clock().toISOString())) {
      store.markNotificationSuppressed(notificationId, "CONSENT_NOT_VALID");
      fail("CONSENT_NOT_VALID");
    }
    if (typeof message.template_key !== "string" || !deps.isTemplateApproved(message.template_key, message.language || "")) {
      store.markNotificationFailed(notificationId, "TEMPLATE_NOT_APPROVED");
      fail("TEMPLATE_NOT_APPROVED");
    }
    var claimed = store.claimNotificationForSend(notificationId, nowIso || deps.clock().toISOString());
    if (!claimed) fail("NOTIFICATION_NOT_CLAIMED");
    // Consent is checked again after claim and immediately before provider submission.
    if (!deps.consentGate(to, message.purpose, deps.clock().toISOString())) {
      store.markNotificationSuppressed(notificationId, "CONSENT_NOT_VALID");
      fail("CONSENT_NOT_VALID");
    }
    try {
      var response = deps.sender(message, notificationId);
      if (!response || response.accepted !== true || !validId(response.provider_message_id)) {
        store.markNotificationFailed(notificationId, "PROVIDER_REJECTED");
        fail("PROVIDER_REJECTED");
      }
      store.markNotificationAccepted(notificationId, response.provider_message_id, deps.clock().toISOString());
      safeLog("provider_accepted", "SENT_TO_PROVIDER");
      return { status: "SENT_TO_PROVIDER", provider_message_id: response.provider_message_id };
    } catch (error) {
      // A timeout can happen after Meta accepted the request. Never blindly retry an
      // ambiguous outcome: reconcile via provider status or operator-approved lookup.
      if (error && error.outcomeUnknown === true || error && error.code === "PROVIDER_TIMEOUT") {
        store.markNotificationOutcomeUnknown(notificationId, "PROVIDER_OUTCOME_UNKNOWN");
        safeLog("provider_outcome_unknown", "PROVIDER_OUTCOME_UNKNOWN");
        return { status: "OUTCOME_UNKNOWN", retry: false };
      }
      var code = error && error.code && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : "PROVIDER_SEND_FAILED";
      var attempts = Number(item.attempt_count || 0) + 1;
      if (error && error.permanent === true) store.markNotificationFailed(notificationId, code);
      else if (attempts >= maxAttempts) store.markNotificationFailed(notificationId, "RETRY_EXHAUSTED");
      else store.markNotificationRetry(notificationId, code, attempts, deps.clock().toISOString());
      safeLog("provider_send_failed", code);
      return { status: attempts >= maxAttempts || error && error.permanent === true ? "FAILED" : "RETRY", code: code };
    }
  }
  return Object.freeze({ receiveWebhook: receiveWebhook, sendQueued: sendQueued });
}
