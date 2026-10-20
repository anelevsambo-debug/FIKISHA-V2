/**
 * Durable notification outbox worker.
 * Provider acceptance is recorded as SENT_TO_PROVIDER, never as recipient delivery.
 * Sender adapters should use notification_id as their provider idempotency key where supported.
 */
function createNotificationOutboxService(deps) {
  if (!deps || !deps.store || !deps.clock || typeof deps.sender !== "function") {
    throw new FikishaError("NOTIFICATION_OUTBOX_DEPENDENCIES_REQUIRED");
  }
  var store = deps.store;
  var maxAttempts = Math.max(1, Math.min(Number(deps.maxAttempts || 5), 5));
  var leaseMs = Math.max(10000, Number(deps.leaseMs || 60000));
  var baseDelayMs = Math.max(1000, Number(deps.baseDelayMs || 30000));
  var log = typeof deps.logger === "function" ? deps.logger : function () {};
  function safeLog(event, code, notification) {
    try { log({ component: "notification_outbox", event: event, code: code,
      notification_id: notification && notification.notification_id || "",
      attempt: Number(notification && notification.attempt_count || 0) }); } catch (ignored) {}
  }
  function asIso(ms) { return new Date(ms).toISOString(); }

  function drain(limit) {
    var nowMs = deps.clock().getTime();
    var due = store.listDueNotifications(asIso(nowMs), Math.max(1, Math.min(Number(limit || 20), 100)));
    var results = [];
    due.forEach(function (item) {
      var claimed;
      try { claimed = store.claimNotification(item.notification_id, asIso(nowMs), asIso(nowMs + leaseMs)); }
      catch (error) {
        safeLog("claim_failed", error && error.code || "OUTBOX_CLAIM_FAILED", item);
        results.push({ notification_id: item.notification_id, status: "CLAIM_FAILED" }); return;
      }
      if (!claimed) { results.push({ notification_id: item.notification_id, status: "NOT_CLAIMED" }); return; }
      if (Number(claimed.attempt_count) > maxAttempts) {
        claimed.status = "FAILED"; claimed.last_error_code = "RETRY_EXHAUSTED"; claimed.lease_until = "";
        claimed.updated_at = asIso(nowMs); store.updateNotification(claimed, "PROCESSING");
        safeLog("retry_exhausted", "RETRY_EXHAUSTED", claimed);
        results.push({ notification_id: claimed.notification_id, status: "FAILED" }); return;
      }
      try {
        var response = deps.sender(claimed, claimed.notification_id);
        if (!response || response.accepted !== true) throw new FikishaError("PROVIDER_NOT_ACCEPTED");
        claimed.status = "SENT_TO_PROVIDER";
        claimed.provider_message_id = response.provider_message_id || response.message_id || "";
        claimed.last_error_code = ""; claimed.lease_until = ""; claimed.next_attempt_at = "";
        claimed.updated_at = asIso(deps.clock().getTime());
        store.updateNotification(claimed, "PROCESSING");
        safeLog("provider_accepted", "SENT_TO_PROVIDER", claimed);
        results.push({ notification_id: claimed.notification_id, status: "SENT_TO_PROVIDER" });
      } catch (error) {
        var failedAt = deps.clock().getTime();
        var code = error && error.code && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : "PROVIDER_SEND_FAILED";
        claimed.last_error_code = code; claimed.lease_until = ""; claimed.updated_at = asIso(failedAt);
        if (Number(claimed.attempt_count) >= maxAttempts) {
          claimed.status = "FAILED"; claimed.next_attempt_at = "";
          safeLog("retry_exhausted", "RETRY_EXHAUSTED", claimed);
        } else {
          claimed.status = "RETRY";
          claimed.next_attempt_at = asIso(failedAt + Math.min(baseDelayMs * Math.pow(2, Math.max(0, Number(claimed.attempt_count) - 1)), 900000));
          safeLog("retry_scheduled", code, claimed);
        }
        store.updateNotification(claimed, "PROCESSING");
        results.push({ notification_id: claimed.notification_id, status: claimed.status, code: code });
      }
    });
    return results;
  }

  function recordDeliveryStatus(notificationId, status, providerMessageId, timestamp) {
    if (!["DELIVERY_CONFIRMED", "DELIVERY_FAILED"].includes(status)) throw new FikishaError("INVALID_PROVIDER_DELIVERY_STATUS");
    var notification = store.getNotification(notificationId);
    if (!notification) throw new FikishaError("NOTIFICATION_NOT_FOUND");
    if (providerMessageId && notification.provider_message_id && providerMessageId !== notification.provider_message_id) {
      throw new FikishaError("PROVIDER_MESSAGE_ID_MISMATCH");
    }
    if (notification.status === "DELIVERY_CONFIRMED" && status === "DELIVERY_CONFIRMED") return notification;
    if (notification.status !== "SENT_TO_PROVIDER" && notification.status !== "DELIVERY_FAILED") {
      throw new FikishaError("NOTIFICATION_NOT_SENT_TO_PROVIDER");
    }
    notification.status = status; notification.updated_at = timestamp || asIso(deps.clock().getTime());
    store.updateNotification(notification);
    safeLog(status === "DELIVERY_CONFIRMED" ? "delivery_confirmed" : "delivery_failed", status, notification);
    return notification;
  }
  return Object.freeze({ drain: drain, recordDeliveryStatus: recordDeliveryStatus });
}
