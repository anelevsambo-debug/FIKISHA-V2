function createSheetsStore(spreadsheetId, lockFactory) {
  if (typeof spreadsheetId !== "string" || !spreadsheetId.trim()) throw new FikishaError("WORKBOOK_ID_REQUIRED");
  if (typeof SpreadsheetApp === "undefined") throw new FikishaError("APPS_SCRIPT_RUNTIME_REQUIRED");

  var ss = SpreadsheetApp.openById(spreadsheetId);
  var lockProvider = lockFactory || function () { return LockService.getScriptLock(); };

  function withLock(work) {
    var lock = lockProvider();
    lock.waitLock(10000);
    try { return work(); }
    finally { lock.releaseLock(); }
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

  function parseIdempotencyRecord(row) {
    try { return JSON.parse(row.result_json); }
    catch (error) { throw new FikishaError("IDEMPOTENCY_RECORD_CORRUPT"); }
  }

  function getDelivery(id) {
    return rows("Deliveries", deliveryHeaders).find(function (row) { return row.delivery_id === id; }) || null;
  }

  function ensureDelivery(delivery) {
    return withLock(function () {
      var existing = rows("Deliveries", deliveryHeaders).find(function (row) {
        return row.delivery_id === delivery.delivery_id;
      });
      if (existing) return { created: false, delivery: existing };
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
    var row = rows("Idempotency", idempotencyHeaders).find(function (value) { return value.key === key; });
    return row ? parseIdempotencyRecord(row) : null;
  }

  function reserveIdempotency(key, candidate) {
    return withLock(function () {
      var existing = rows("Idempotency", idempotencyHeaders).find(function (row) { return row.key === key; });
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
      var index = all.findIndex(function (row) { return row.key === key; });
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
      var index = all.findIndex(function (row) { return row.key === key; });
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
      var index = all.findIndex(function (row) { return row.delivery_id === delivery.delivery_id; });
      if (index < 0) throw new FikishaError("DELIVERY_NOT_FOUND");
      if (Number(all[index].version) !== Number(expectedVersion)) throw new FikishaError("CONCURRENT_UPDATE");
      sheet("Deliveries", deliveryHeaders).getRange(index + 2, 1, 1, deliveryHeaders.length).setValues([deliveryHeaders.map(function (h) {
        return delivery[h] === undefined ? "" : delivery[h];
      })]);
      return delivery;
    });
  }

  return Object.freeze({
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
    }
  });
}
