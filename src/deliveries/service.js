function createDeliveryService(deps) {
  if (!deps || !deps.store || !deps.clock || !deps.idFactory) throw new FikishaError("SERVICE_DEPENDENCIES_REQUIRED");
  if (!deps.actorResolver || typeof deps.actorResolver.assertTrusted !== "function") {
    throw new FikishaError("ACTOR_RESOLVER_REQUIRED");
  }

  var store = deps.store;

  if (typeof store.getIdempotency !== "function" ||
      typeof store.reserveIdempotency !== "function" ||
      typeof store.completeIdempotency !== "function" ||
      typeof store.ensureDelivery !== "function" ||
      typeof store.ensureEvent !== "function") {
    throw new FikishaError("RECOVERABLE_IDEMPOTENCY_STORE_REQUIRED");
  }

  function actorCheck(actor, companyId) {
    deps.actorResolver.assertTrusted(actor);
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

  function sameCreateRequest(delivery, input, actor) {
    return delivery &&
      delivery.created_by === actor.actor_id &&
      delivery.company_id === actor.company_id &&
      delivery.sender_name === input.sender_name.trim() &&
      delivery.sender_phone === input.sender_phone &&
      delivery.recipient_name === input.recipient_name.trim() &&
      delivery.recipient_phone === input.recipient_phone &&
      delivery.pickup_text === input.pickup_text.trim() &&
      delivery.dropoff_text === input.dropoff_text.trim() &&
      delivery.instructions === (isNonEmptyString(input.instructions) ? input.instructions.trim() : "") &&
      delivery.consent_status === input.consent_status;
  }

  function enqueueTransitionNotification(event, operationId) {
    if (typeof store.enqueueNotification !== "function") return;
    store.enqueueNotification({
      notification_id: "transition:" + operationId,
      company_id: event.company_id,
      delivery_id: event.delivery_id,
      event_id: event.event_id,
      recipient_actor_id: "",
      channel: "INTERNAL",
      template_key: "DELIVERY_STATE_CHANGED",
      payload_json: JSON.stringify({
        event_id: event.event_id,
        delivery_id: event.delivery_id,
        event_type: event.event_type,
        from_status: event.from_status,
        to_status: event.to_status,
        actor_id: event.actor_id
      }),
      status: "PENDING",
      attempt_count: 0,
      next_attempt_at: "",
      lease_until: "",
      last_error_code: "",
      provider_message_id: "",
      created_at: event.created_at,
      updated_at: event.created_at
    });
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
    enqueueTransitionNotification(event, delivery.last_operation_id || record.operation_id || delivery.delivery_id);
    var completedAt = deps.clock().toISOString();
    store.completeIdempotency(key, {
      state: "COMPLETED",
      operation_type: "CREATE",
      operation_id: record.operation_id || delivery.delivery_id,
      result: delivery,
      created_at: record.created_at || delivery.created_at,
      updated_at: completedAt
    });
    return delivery;
  }

  function createUnlocked(input, actor, idempotencyKey) {
    deps.actorResolver.assertTrusted(actor);
    if (!actor.company_id || actor.active !== true || !["COMPANY_ADMIN", "DISPATCHER"].includes(actor.role)) {
      throw new FikishaError("DELIVERY_CREATE_FORBIDDEN");
    }

    var validation = validateDeliveryInput(input);
    if (!validation.ok) throw new FikishaError("DELIVERY_VALIDATION_FAILED", validation.errors.join(","));
    if (!isNonEmptyString(idempotencyKey) || idempotencyKey.length > 128) throw new FikishaError("IDEMPOTENCY_KEY_REQUIRED");

    var key = actor.company_id + ":" + idempotencyKey;
    var prior = store.getIdempotency(key);
    if (prior) {
      var priorDelivery = prior.delivery || prior.result;
      if (priorDelivery && !sameCreateRequest(priorDelivery, input, actor)) throw new FikishaError("IDEMPOTENCY_KEY_REUSED");
      if (!prior.state && prior.result) return prior.result;
      if (prior.state === "COMPLETED") {
        if (prior.operation_type !== "CREATE" || !prior.result) throw new FikishaError("IDEMPOTENCY_KEY_REUSED");
        return prior.result;
      }
      if (prior.state !== "IN_PROGRESS" || (prior.operation_type && prior.operation_type !== "CREATE")) {
        throw new FikishaError("IDEMPOTENCY_STATE_INVALID");
      }
      return resumeCreate(key, prior);
    }
    var now = deps.clock().toISOString();
    var deliveryId = deps.idFactory();
    var delivery = {
      delivery_id: deliveryId,
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
      version: 1,
      last_operation_id: deliveryId
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
      operation_type: "CREATE",
      operation_id: delivery.delivery_id,
      delivery: delivery,
      event: event,
      created_at: now,
      updated_at: now
    };

    var reservation = store.reserveIdempotency(key, candidate);
    if (!reservation || !reservation.record) throw new FikishaError("IDEMPOTENCY_RESERVATION_FAILED");
    var record = reservation.record;
    var reservedDelivery = record.delivery || record.result;
    if (reservedDelivery && !sameCreateRequest(reservedDelivery, input, actor)) throw new FikishaError("IDEMPOTENCY_KEY_REUSED");

    // Read legacy completed records written by the previous adapter/service shape.
    if (!record.state && record.result) return record.result;
    if (record.state === "COMPLETED") {
      if (record.operation_type !== "CREATE" || !record.result) throw new FikishaError("IDEMPOTENCY_KEY_REUSED");
      return record.result;
    }
    if (record.state !== "IN_PROGRESS" || record.operation_type !== "CREATE") throw new FikishaError("IDEMPOTENCY_STATE_INVALID");

    return resumeCreate(key, record);
  }

  function transitionAlreadyApplied(current, record) {
    return current &&
      current.last_operation_id === record.operation_id &&
      Number(current.version) === Number(record.delivery.version) &&
      current.status === record.delivery.status;
  }

  function assertSameTransitionRequest(record, args, actor) {
    if (!record || record.operation_type !== "TRANSITION" ||
        record.delivery_id !== args.delivery_id ||
        !record.event ||
        record.event.event_type !== args.action ||
        record.event.actor_id !== actor.actor_id ||
        (record.event.reason || "") !== (args.reason || "") ||
        (record.event.proof_id || "") !== (args.proof_id || "") ||
        (args.action === "ACCEPT_OFFER" && record.delivery.driver_id !== args.driver_id)) {
      throw new FikishaError("IDEMPOTENCY_KEY_REUSED");
    }
  }

  function resumeTransition(key, record) {
    var current = store.getDelivery(record.delivery_id);
    if (!current) throw new FikishaError("DELIVERY_NOT_FOUND");

    if (!transitionAlreadyApplied(current, record)) {
      if (Number(current.version) !== Number(record.expected_version) || current.status !== record.from_status) {
        throw new FikishaError("TRANSITION_RECOVERY_CONFLICT");
      }
      try {
        store.saveDelivery(record.delivery, record.expected_version);
      } catch (error) {
        var latest = store.getDelivery(record.delivery_id);
        if (!transitionAlreadyApplied(latest, record)) throw error;
      }
      current = store.getDelivery(record.delivery_id);
      if (!transitionAlreadyApplied(current, record)) throw new FikishaError("TRANSITION_RECOVERY_CONFLICT");
    }

    store.ensureEvent(record.event);
    enqueueTransitionNotification(record.event, record.operation_id);
    var completedAt = deps.clock().toISOString();
    store.completeIdempotency(key, {
      state: "COMPLETED",
      operation_type: "TRANSITION",
      operation_id: record.operation_id,
      delivery_id: record.delivery_id,
      expected_version: record.expected_version,
      from_status: record.from_status,
      delivery: record.delivery,
      event: record.event,
      result: record.delivery,
      created_at: record.created_at,
      updated_at: completedAt
    });
    return record.delivery;
  }

  function transitionUnlocked(args, actor) {
    if (!args || !isNonEmptyString(args.delivery_id) || !isNonEmptyString(args.action)) {
      throw new FikishaError("INVALID_TRANSITION_REQUEST");
    }
    if (!isNonEmptyString(args.idempotency_key) || args.idempotency_key.length > 128) {
      throw new FikishaError("IDEMPOTENCY_KEY_REQUIRED");
    }

    var current = store.getDelivery(args.delivery_id);
    if (!current) throw new FikishaError("DELIVERY_NOT_FOUND");
    actorCheck(actor, current.company_id);

    var key = actor.company_id + ":TRANSITION:" + args.idempotency_key;
    var prior = store.getIdempotency(key);
    if (prior) {
      assertSameTransitionRequest(prior, args, actor);
      if (prior.state === "COMPLETED") {
        if (!prior.result) throw new FikishaError("IDEMPOTENCY_RECORD_CORRUPT");
        return prior.result;
      }
      if (prior.state !== "IN_PROGRESS") throw new FikishaError("IDEMPOTENCY_STATE_INVALID");
      return resumeTransition(key, prior);
    }

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
    var operationId = deps.idFactory();
    var updated = Object.assign({}, current, {
      status: decision.to,
      updated_at: now,
      version: Number(current.version || 0) + 1,
      last_operation_id: operationId
    });
    if (decision.to === "ASSIGNED") updated.driver_id = args.driver_id;
    if (decision.to === "DELIVERED_VERIFIED") {
      updated.proof_id = args.proof_id;
      updated.delivered_at = now;
    }
    if (decision.to === "DELIVERY_ATTEMPTED") updated.failure_reason = args.reason.trim();

    var event = {
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
    };
    var candidate = {
      state: "IN_PROGRESS",
      operation_type: "TRANSITION",
      operation_id: operationId,
      delivery_id: current.delivery_id,
      expected_version: Number(current.version || 0),
      from_status: current.status,
      delivery: updated,
      event: event,
      created_at: now,
      updated_at: now
    };
    var reservation = store.reserveIdempotency(key, candidate);
    if (!reservation || !reservation.record) throw new FikishaError("IDEMPOTENCY_RESERVATION_FAILED");
    var record = reservation.record;
    assertSameTransitionRequest(record, args, actor);
    if (record.state === "COMPLETED") {
      if (!record.result) throw new FikishaError("IDEMPOTENCY_RECORD_CORRUPT");
      return record.result;
    }
    if (record.state !== "IN_PROGRESS") throw new FikishaError("IDEMPOTENCY_STATE_INVALID");
    return resumeTransition(key, record);
  }

  function runExclusive(work) {
    return typeof store.runExclusive === "function" ? store.runExclusive(work) : work();
  }

  function create(input, actor, idempotencyKey) {
    return runExclusive(function () { return createUnlocked(input, actor, idempotencyKey); });
  }

  function transition(args, actor) {
    return runExclusive(function () { return transitionUnlocked(args, actor); });
  }

  function get(id, actor) {
    var delivery = store.getDelivery(id);
    if (!delivery) throw new FikishaError("DELIVERY_NOT_FOUND");
    actorCheck(actor, delivery.company_id);
    return delivery;
  }

  return Object.freeze({ create: create, transition: transition, get: get });
}
