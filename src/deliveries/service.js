function createDeliveryService(deps) {
  if (!deps || !deps.store || !deps.clock || !deps.idFactory) throw new FikishaError("SERVICE_DEPENDENCIES_REQUIRED");

  var store = deps.store;
  if (typeof store.reserveIdempotency !== "function" ||
      typeof store.completeIdempotency !== "function" ||
      typeof store.ensureDelivery !== "function" ||
      typeof store.ensureEvent !== "function") {
    throw new FikishaError("RECOVERABLE_IDEMPOTENCY_STORE_REQUIRED");
  }

  function actorCheck(actor, companyId) {
    if (!actor || actor.active !== true || actor.company_id !== companyId) throw new FikishaError("TENANT_ACCESS_DENIED");
    if (actor.role === "DEVELOPER") throw new FikishaError("DEVELOPER_DELIVERY_ACCESS_DENIED");
  }

  function normalizedTimestamp(value) {
    if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
    return String(value === undefined || value === null ? "" : value);
  }

  function sameCreateIdentity(existing, intended) {
    return existing &&
      existing.delivery_id === intended.delivery_id &&
      existing.company_id === intended.company_id &&
      existing.created_by === intended.created_by &&
      normalizedTimestamp(existing.created_at) === normalizedTimestamp(intended.created_at);
  }

  function resumeCreate(key, record) {
    var delivery = record && record.delivery;
    var event = record && record.event;
    if (!delivery || !event || !delivery.delivery_id || !event.event_id) {
      throw new FikishaError("IDEMPOTENCY_OPERATION_RECORD_INVALID");
    }

    var existing = store.getDelivery(delivery.delivery_id);
    if (existing && !sameCreateIdentity(existing, delivery)) throw new FikishaError("DELIVERY_ID_CONFLICT");

    if (!existing) {
      var ensured = store.ensureDelivery(delivery);
      existing = ensured && ensured.delivery ? ensured.delivery : store.getDelivery(delivery.delivery_id);
      if (!sameCreateIdentity(existing, delivery)) throw new FikishaError("DELIVERY_ID_CONFLICT");
    }

    store.ensureEvent(event);
    var completedAt = deps.clock().toISOString();
    store.completeIdempotency(key, {
      state: "COMPLETED",
      operation_id: record.operation_id || delivery.delivery_id,
      result: delivery,
      created_at: record.created_at || delivery.created_at,
      updated_at: completedAt
    });
    return delivery;
  }

  function create(input, actor, idempotencyKey) {
    if (!actor || !actor.company_id || !actor.active || !["COMPANY_ADMIN", "DISPATCHER"].includes(actor.role)) {
      throw new FikishaError("DELIVERY_CREATE_FORBIDDEN");
    }

    var validation = validateDeliveryInput(input);
    if (!validation.ok) throw new FikishaError("DELIVERY_VALIDATION_FAILED", validation.errors.join(","));
    if (!isNonEmptyString(idempotencyKey) || idempotencyKey.length > 128) throw new FikishaError("IDEMPOTENCY_KEY_REQUIRED");

    var key = actor.company_id + ":" + idempotencyKey;
    var now = deps.clock().toISOString();
    var delivery = {
      delivery_id: deps.idFactory(),
      company_id: actor.company_id,
      status: "RECEIVED",
      sender_name: input.sender_name.trim(),
      sender_phone: input.sender_phone,
      recipient_name: input.recipient_name.trim(),
      recipient_phone: input.recipient_phone,
      pickup_text: input.pickup_text.trim(),
      dropoff_text: input.dropoff_text.trim(),
      instructions: isNonEmptyString(input.instructions) ? input.instructions.trim() : "",
      consent_status: input.consent_status,
      created_at: now,
      updated_at: now,
      created_by: actor.actor_id,
      version: 1
    };
    var event = {
      event_id: deps.idFactory(),
      company_id: actor.company_id,
      delivery_id: delivery.delivery_id,
      event_type: "DELIVERY_CREATED",
      actor_id: actor.actor_id,
      from_status: "",
      to_status: "RECEIVED",
      reason: "",
      proof_id: "",
      created_at: now
    };
    var candidate = {
      state: "IN_PROGRESS",
      operation_id: delivery.delivery_id,
      delivery: delivery,
      event: event,
      created_at: now,
      updated_at: now
    };

    var reservation = store.reserveIdempotency(key, candidate);
    if (!reservation || !reservation.record) throw new FikishaError("IDEMPOTENCY_RESERVATION_FAILED");
    var record = reservation.record;

    // Read legacy completed records written by the previous adapter/service shape.
    if (!record.state && record.result) return record.result;
    if (record.state === "COMPLETED") {
      if (!record.result) throw new FikishaError("IDEMPOTENCY_RECORD_CORRUPT");
      return record.result;
    }
    if (record.state !== "IN_PROGRESS") throw new FikishaError("IDEMPOTENCY_STATE_INVALID");

    return resumeCreate(key, record);
  }

  function transition(args, actor) {
    if (!args || !isNonEmptyString(args.delivery_id) || !isNonEmptyString(args.action)) {
      throw new FikishaError("INVALID_TRANSITION_REQUEST");
    }
    var current = store.getDelivery(args.delivery_id);
    if (!current) throw new FikishaError("DELIVERY_NOT_FOUND");
    actorCheck(actor, current.company_id);

    var decision = decideTransition(current.status, args.action, actor.role);
    if (!decision.ok) throw new FikishaError(decision.reason_code || "INVALID_TRANSITION");
    if (decision.to === "DELIVERED_VERIFIED" &&
        (!isNonEmptyString(args.proof_id) || !store.isProofVerified(args.proof_id, current.delivery_id, current.company_id))) {
      throw new FikishaError("VERIFIED_PROOF_REQUIRED");
    }
    if (decision.to === "ASSIGNED" &&
        (!isNonEmptyString(args.driver_id) || !store.isActiveDriver(args.driver_id, current.company_id))) {
      throw new FikishaError("ACTIVE_COMPANY_DRIVER_REQUIRED");
    }
    if (decision.to === "DELIVERY_ATTEMPTED" && !isNonEmptyString(args.reason)) {
      throw new FikishaError("FAILURE_REASON_REQUIRED");
    }

    var now = deps.clock().toISOString();
    var updated = Object.assign({}, current, {
      status: decision.to,
      updated_at: now,
      version: Number(current.version || 0) + 1
    });
    if (decision.to === "ASSIGNED") updated.driver_id = args.driver_id;
    if (decision.to === "DELIVERED_VERIFIED") {
      updated.proof_id = args.proof_id;
      updated.delivered_at = now;
    }
    if (decision.to === "DELIVERY_ATTEMPTED") updated.failure_reason = args.reason.trim();

    store.saveDelivery(updated, current.version);
    store.appendEvent({
      event_id: deps.idFactory(),
      company_id: current.company_id,
      delivery_id: current.delivery_id,
      event_type: args.action,
      actor_id: actor.actor_id,
      from_status: current.status,
      to_status: decision.to,
      reason: args.reason || "",
      proof_id: args.proof_id || "",
      created_at: now
    });
    return updated;
  }

  function get(id, actor) {
    var delivery = store.getDelivery(id);
    if (!delivery) throw new FikishaError("DELIVERY_NOT_FOUND");
    actorCheck(actor, delivery.company_id);
    return delivery;
  }

  return Object.freeze({ create: create, transition: transition, get: get });
}
