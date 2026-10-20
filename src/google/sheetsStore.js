function createSheetsStore(spreadsheetId, lockFactory, logger) {
  if (typeof spreadsheetId !== "string" || !spreadsheetId.trim()) throw new FikishaError("WORKBOOK_ID_REQUIRED");
  if (typeof SpreadsheetApp === "undefined") throw new FikishaError("APPS_SCRIPT_RUNTIME_REQUIRED");

  var ss = SpreadsheetApp.openById(spreadsheetId);
  var lockProvider = lockFactory || function () { return LockService.getScriptLock(); };
  var log = typeof logger === "function" ? logger : function () {};
  var lockDepth = 0;

  function logReliability(event, code) {
    try { log({ component: "sheets_store", event: event, code: code }); } catch (ignored) {}
  }

  function withLock(work) {
    if (lockDepth > 0) {
      lockDepth += 1;
      try { return work(); } finally { lockDepth -= 1; }
    }
    var lock;
    try { lock = lockProvider(); }
    catch (error) {
      logReliability("lock_unavailable", "LOCK_UNAVAILABLE");
      throw new FikishaError("LOCK_UNAVAILABLE");
    }
    try { lock.waitLock(10000); }
    catch (error) {
      logReliability("lock_acquisition_failed", "LOCK_ACQUISITION_TIMEOUT");
      throw new FikishaError("LOCK_ACQUISITION_TIMEOUT");
    }
    lockDepth = 1;
    var workFailed = false;
    try { return work(); }
    catch (error) { workFailed = true; throw error; }
    finally {
      lockDepth = 0;
      try { lock.releaseLock(); }
      catch (error) {
        logReliability("lock_release_failed", "LOCK_RELEASE_FAILED");
        if (!workFailed) throw new FikishaError("LOCK_RELEASE_FAILED");
      }
    }
  }

  function sheet(name, headers) {
    var sh = ss.getSheetByName(name);
    if (!sh) throw new FikishaError("REQUIRED_SHEET_MISSING", name);
    var actual = sh.getRange(1, 1, 1, headers.length).getValues()[0];
    if (headers.some(function (h, i) { return actual[i] !== h; })) throw new FikishaError("SHEET_SCHEMA_MISMATCH", name);
    return sh;
  }

  function rows(name, headers) {
    var sh = sheet(name, headers), last = sh.getLastRow();
    if (last < 2) return [];
    return sh.getRange(2, 1, last - 1, headers.length).getValues().map(function (row) {
      var value = {};
      headers.forEach(function (h, i) { value[h] = row[i]; });
      return value;
    });
  }

  function append(name, headers, value) {
    return withLock(function () {
      sheet(name, headers).appendRow(headers.map(function (h) {
        return value[h] === undefined ? "" : value[h];
      }));
    });
  }

  var deliveryHeaders = ["delivery_id", "company_id", "status", "sender_name", "sender_phone", "recipient_name", "recipient_phone", "pickup_text", "dropoff_text", "instructions", "consent_status", "created_at", "updated_at", "created_by", "version", "last_operation_id", "driver_id", "proof_id", "delivered_at", "failure_reason"];
  var eventHeaders = ["event_id", "company_id", "delivery_id", "event_type", "actor_id", "from_status", "to_status", "reason", "proof_id", "created_at"];
  var idempotencyHeaders = ["key", "result_json", "created_at"];
  var offerHeaders = ["offer_id", "company_id", "delivery_id", "driver_id", "status", "expires_at", "created_at", "responded_at", "response_actor_id", "request_key", "attempt_number"];
  var outboxHeaders = ["notification_id", "company_id", "delivery_id", "event_id", "recipient_actor_id", "channel", "template_key", "payload_json", "status", "attempt_count", "next_attempt_at", "lease_until", "last_error_code", "provider_message_id", "created_at", "updated_at"];

  function parseIdempotencyRecord(row) {
    try { return JSON.parse(row.result_json); }
    catch (error) { throw new FikishaError("IDEMPOTENCY_RECORD_CORRUPT"); }
  }

  function findUnique(items, predicate, duplicateCode) {
    var matches = items.filter(predicate);
    if (matches.length > 1) throw new FikishaError(duplicateCode);
    return matches.length ? matches[0] : null;
  }

  function getDelivery(id) {
    return findUnique(rows("Deliveries", deliveryHeaders), function (row) {
      return row.delivery_id === id;
    }, "DUPLICATE_DELIVERY_RECORD");
  }

  function ensureDelivery(delivery) {
    return withLock(function () {
      var existing = findUnique(rows("Deliveries", deliveryHeaders), function (row) {
        return row.delivery_id === delivery.delivery_id;
      }, "DUPLICATE_DELIVERY_RECORD");
      if (existing) {
        if (existing.company_id !== delivery.company_id) throw new FikishaError("DELIVERY_ID_CONFLICT");
        return { created: false, delivery: existing };
      }
      sheet("Deliveries", deliveryHeaders).appendRow(deliveryHeaders.map(function (h) {
        return delivery[h] === undefined ? "" : delivery[h];
      }));
      return { created: true, delivery: delivery };
    });
  }

  function ensureEvent(event) {
    return withLock(function () {
      var existing = rows("DeliveryEvents", eventHeaders).find(function (row) {
        return row.event_id === event.event_id;
      });
      if (existing) {
        if (existing.company_id !== event.company_id ||
            existing.delivery_id !== event.delivery_id ||
            existing.event_type !== event.event_type) {
          throw new FikishaError("EVENT_ID_CONFLICT");
        }
        return { created: false, event: existing };
      }
      sheet("DeliveryEvents", eventHeaders).appendRow(eventHeaders.map(function (h) {
        return event[h] === undefined ? "" : event[h];
      }));
      return { created: true, event: event };
    });
  }

  function getIdempotency(key) {
    var row = findUnique(rows("Idempotency", idempotencyHeaders), function (value) {
      return value.key === key;
    }, "DUPLICATE_IDEMPOTENCY_KEY");
    return row ? parseIdempotencyRecord(row) : null;
  }

  function reserveIdempotency(key, candidate) {
    return withLock(function () {
      var existing = findUnique(rows("Idempotency", idempotencyHeaders), function (row) { return row.key === key; }, "DUPLICATE_IDEMPOTENCY_KEY");
      if (existing) return { created: false, record: parseIdempotencyRecord(existing) };
      sheet("Idempotency", idempotencyHeaders).appendRow([
        key,
        JSON.stringify(candidate),
        candidate.created_at || new Date().toISOString()
      ]);
      return { created: true, record: candidate };
    });
  }

  function completeIdempotency(key, record) {
    return withLock(function () {
      var all = rows("Idempotency", idempotencyHeaders);
      var matches = all.map(function (row, index) { return { row: row, index: index }; }).filter(function (item) { return item.row.key === key; });
      if (matches.length > 1) throw new FikishaError("DUPLICATE_IDEMPOTENCY_KEY");
      var index = matches.length ? matches[0].index : -1;
      if (index < 0) throw new FikishaError("IDEMPOTENCY_RESERVATION_MISSING");
      var createdAt = all[index].created_at || record.created_at || new Date().toISOString();
      sheet("Idempotency", idempotencyHeaders).getRange(index + 2, 1, 1, idempotencyHeaders.length).setValues([[
        key,
        JSON.stringify(record),
        createdAt
      ]]);
      return record;
    });
  }

  function saveIdempotency(key, value) {
    return withLock(function () {
      var all = rows("Idempotency", idempotencyHeaders);
      var matches = all.map(function (row, index) { return { row: row, index: index }; }).filter(function (item) { return item.row.key === key; });
      if (matches.length > 1) throw new FikishaError("DUPLICATE_IDEMPOTENCY_KEY");
      var index = matches.length ? matches[0].index : -1;
      var createdAt = index >= 0 ? all[index].created_at : (value.created_at || new Date().toISOString());
      var data = [key, JSON.stringify(value), createdAt];
      if (index < 0) sheet("Idempotency", idempotencyHeaders).appendRow(data);
      else sheet("Idempotency", idempotencyHeaders).getRange(index + 2, 1, 1, idempotencyHeaders.length).setValues([data]);
      return value;
    });
  }

  function saveDelivery(delivery, expectedVersion) {
    return withLock(function () {
      var all = rows("Deliveries", deliveryHeaders);
      var matches = all.map(function (row, index) { return { row: row, index: index }; })
        .filter(function (item) { return item.row.delivery_id === delivery.delivery_id; });
      if (matches.length > 1) throw new FikishaError("DUPLICATE_DELIVERY_RECORD");
      if (matches.length === 0) throw new FikishaError("DELIVERY_NOT_FOUND");
      var index = matches[0].index;
      if (matches[0].row.company_id !== delivery.company_id) throw new FikishaError("TENANT_MISMATCH");
      if (Number(matches[0].row.version) !== Number(expectedVersion)) throw new FikishaError("CONCURRENT_UPDATE");
      sheet("Deliveries", deliveryHeaders).getRange(index + 2, 1, 1, deliveryHeaders.length).setValues([deliveryHeaders.map(function (h) {
        return delivery[h] === undefined ? "" : delivery[h];
      })]);
      return delivery;
    });
  }


  function getOffer(offerId) {
    return findUnique(rows("DriverOffers", offerHeaders), function (row) {
      return row.offer_id === offerId;
    }, "DUPLICATE_DRIVER_OFFER");
  }

  function getOfferByRequestKey(companyId, requestKey) {
    return findUnique(rows("DriverOffers", offerHeaders), function (row) {
      return row.company_id === companyId && row.request_key === requestKey;
    }, "DUPLICATE_DRIVER_OFFER_REQUEST");
  }

  function listOffersForDelivery(deliveryId) {
    return rows("DriverOffers", offerHeaders).filter(function (row) {
      return row.delivery_id === deliveryId;
    });
  }

  function createOffer(offer) {
    return withLock(function () {
      var all = rows("DriverOffers", offerHeaders);
      var byId = findUnique(all, function (row) { return row.offer_id === offer.offer_id; }, "DUPLICATE_DRIVER_OFFER");
      var byKey = findUnique(all, function (row) { return row.company_id === offer.company_id && row.request_key === offer.request_key; }, "DUPLICATE_DRIVER_OFFER_REQUEST");
      if (byId) {
        if (byId.company_id !== offer.company_id || byId.delivery_id !== offer.delivery_id ||
            byId.driver_id !== offer.driver_id || byId.request_key !== offer.request_key) {
          throw new FikishaError("DRIVER_OFFER_ID_CONFLICT");
        }
        return { created: false, offer: byId };
      }
      if (byKey) {
        if (byKey.delivery_id !== offer.delivery_id || byKey.driver_id !== offer.driver_id) {
          throw new FikishaError("DRIVER_OFFER_REQUEST_KEY_REUSED");
        }
        return { created: false, offer: byKey };
      }
      sheet("DriverOffers", offerHeaders).appendRow(offerHeaders.map(function (h) {
        return offer[h] === undefined ? "" : offer[h];
      }));
      return { created: true, offer: offer };
    });
  }

  function updateOffer(offer, expectedStatus) {
    return withLock(function () {
      var all = rows("DriverOffers", offerHeaders);
      var matches = all.map(function (row, index) { return { row: row, index: index }; })
        .filter(function (item) { return item.row.offer_id === offer.offer_id; });
      if (matches.length > 1) throw new FikishaError("DUPLICATE_DRIVER_OFFER");
      if (!matches.length) throw new FikishaError("DRIVER_OFFER_NOT_FOUND");
      var current = matches[0].row;
      if (current.company_id !== offer.company_id) throw new FikishaError("TENANT_MISMATCH");
      if (expectedStatus && current.status !== expectedStatus) throw new FikishaError("DRIVER_OFFER_STATUS_CONFLICT");
      sheet("DriverOffers", offerHeaders).getRange(matches[0].index + 2, 1, 1, offerHeaders.length).setValues([offerHeaders.map(function (h) {
        return offer[h] === undefined ? "" : offer[h];
      })]);
      return offer;
    });
  }

  function enqueueNotification(record) {
    return withLock(function () {
      var all = rows("NotificationOutbox", outboxHeaders);
      var existing = findUnique(all, function (row) { return row.notification_id === record.notification_id; }, "DUPLICATE_NOTIFICATION_RECORD");
      if (existing) {
        if (existing.company_id !== record.company_id || existing.delivery_id !== record.delivery_id ||
            existing.event_id !== record.event_id || existing.template_key !== record.template_key) {
          throw new FikishaError("NOTIFICATION_ID_CONFLICT");
        }
        return { created: false, notification: existing };
      }
      sheet("NotificationOutbox", outboxHeaders).appendRow(outboxHeaders.map(function (h) {
        return record[h] === undefined ? "" : record[h];
      }));
      return { created: true, notification: record };
    });
  }

  function getNotification(notificationId) {
    return findUnique(rows("NotificationOutbox", outboxHeaders), function (row) {
      return row.notification_id === notificationId;
    }, "DUPLICATE_NOTIFICATION_RECORD");
  }

  function listDueNotifications(nowIso, limit) {
    var now = String(nowIso);
    return rows("NotificationOutbox", outboxHeaders).filter(function (row) {
      if (row.status === "PROCESSING" && row.lease_until && String(row.lease_until) <= now) return true;
      if (Number(row.attempt_count || 0) >= 5) return false;
      if (row.status === "PENDING" || row.status === "RETRY") return !row.next_attempt_at || String(row.next_attempt_at) <= now;
      return false;
    }).slice(0, Math.max(0, Math.min(Number(limit || 20), 100)));
  }

  function claimNotification(notificationId, nowIso, leaseUntilIso) {
    return withLock(function () {
      var all = rows("NotificationOutbox", outboxHeaders);
      var matches = all.map(function (row, index) { return { row: row, index: index }; })
        .filter(function (item) { return item.row.notification_id === notificationId; });
      if (matches.length > 1) throw new FikishaError("DUPLICATE_NOTIFICATION_RECORD");
      if (!matches.length) throw new FikishaError("NOTIFICATION_NOT_FOUND");
      var row = matches[0].row;
      if (Number(row.attempt_count || 0) >= 5) {
        if (row.status === "PROCESSING" && row.lease_until && String(row.lease_until) <= String(nowIso)) {
          row.status = "FAILED";
          row.last_error_code = row.last_error_code || "RETRY_EXHAUSTED_AFTER_INTERRUPTION";
          row.lease_until = "";
          row.updated_at = nowIso;
          sheet("NotificationOutbox", outboxHeaders).getRange(matches[0].index + 2, 1, 1, outboxHeaders.length).setValues([outboxHeaders.map(function (h) { return row[h] === undefined ? "" : row[h]; })]);
        }
        return null;
      }
      var due = (row.status === "PENDING" || row.status === "RETRY") && (!row.next_attempt_at || String(row.next_attempt_at) <= String(nowIso));
      var leaseExpired = row.status === "PROCESSING" && row.lease_until && String(row.lease_until) <= String(nowIso);
      if (!due && !leaseExpired) return null;
      row.status = "PROCESSING";
      row.attempt_count = Number(row.attempt_count || 0) + 1;
      row.lease_until = leaseUntilIso;
      row.updated_at = nowIso;
      sheet("NotificationOutbox", outboxHeaders).getRange(matches[0].index + 2, 1, 1, outboxHeaders.length).setValues([outboxHeaders.map(function (h) {
        return row[h] === undefined ? "" : row[h];
      })]);
      return row;
    });
  }

  function updateNotification(record, expectedStatus) {
    return withLock(function () {
      var all = rows("NotificationOutbox", outboxHeaders);
      var matches = all.map(function (row, index) { return { row: row, index: index }; })
        .filter(function (item) { return item.row.notification_id === record.notification_id; });
      if (matches.length > 1) throw new FikishaError("DUPLICATE_NOTIFICATION_RECORD");
      if (!matches.length) throw new FikishaError("NOTIFICATION_NOT_FOUND");
      if (expectedStatus && matches[0].row.status !== expectedStatus) throw new FikishaError("NOTIFICATION_STATUS_CONFLICT");
      sheet("NotificationOutbox", outboxHeaders).getRange(matches[0].index + 2, 1, 1, outboxHeaders.length).setValues([outboxHeaders.map(function (h) {
        return record[h] === undefined ? "" : record[h];
      })]);
      return record;
    });
  }

  return Object.freeze({
    runExclusive: function (work) { if (typeof work !== "function") throw new FikishaError("LOCK_CALLBACK_REQUIRED"); return withLock(work); },
    getDelivery: getDelivery,
    insertDelivery: function (delivery) {
      var result = ensureDelivery(delivery);
      if (!result.created) throw new FikishaError("DELIVERY_ID_CONFLICT");
      return result.delivery;
    },
    ensureDelivery: ensureDelivery,
    saveDelivery: saveDelivery,
    appendEvent: function (event) { return append("DeliveryEvents", eventHeaders, event); },
    ensureEvent: ensureEvent,
    getIdempotency: getIdempotency,
    reserveIdempotency: reserveIdempotency,
    completeIdempotency: completeIdempotency,
    saveIdempotency: saveIdempotency,
    isProofVerified: function (proofId, deliveryId, companyId) {
      return rows("ProofOfDelivery", ["proof_id", "delivery_id", "company_id", "verified", "created_at"]).some(function (row) {
        return row.proof_id === proofId && row.delivery_id === deliveryId && row.company_id === companyId && String(row.verified).toUpperCase() === "TRUE";
      });
    },
    isActiveDriver: function (driverId, companyId) {
      return rows("Drivers", ["driver_id", "company_id", "status"]).some(function (row) {
        return row.driver_id === driverId && row.company_id === companyId && row.status === "ACTIVE";
      });
    },
    getOffer: getOffer,
    getOfferByRequestKey: getOfferByRequestKey,
    listOffersForDelivery: listOffersForDelivery,
    createOffer: createOffer,
    updateOffer: updateOffer,
    enqueueNotification: enqueueNotification,
    getNotification: getNotification,
    listDueNotifications: listDueNotifications,
    claimNotification: claimNotification,
    updateNotification: updateNotification
  });
}
