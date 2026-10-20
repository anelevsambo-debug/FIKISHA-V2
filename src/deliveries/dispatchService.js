/**
 * Durable driver-offer workflow. State changes continue through the approved delivery state machine.
 * All mutations run under the store's exclusive lock; messages are outbox records, not state authority.
 */
function createDispatchService(deps) {
  if (!deps || !deps.store || !deps.deliveryService || !deps.actorResolver ||
      typeof deps.actorResolver.assertTrusted !== "function" || !deps.clock || !deps.idFactory) {
    throw new FikishaError("DISPATCH_SERVICE_DEPENDENCIES_REQUIRED");
  }
  var store = deps.store;
  var ttlMs = Number(deps.offerTtlMs || 120000);

  function exclusive(work) {
    if (typeof store.runExclusive !== "function") throw new FikishaError("EXCLUSIVE_STORE_REQUIRED");
    return store.runExclusive(work);
  }
  function now() { return deps.clock().getTime(); }
  function iso(value) { return new Date(value).toISOString(); }
  function assertActor(actor, companyId, roles) {
    deps.actorResolver.assertTrusted(actor);
    if (!actor || actor.active !== true || actor.company_id !== companyId || roles.indexOf(actor.role) < 0) {
      throw new FikishaError("DISPATCH_ACCESS_DENIED");
    }
  }
  function enqueueOfferNotification(offer) {
    store.enqueueNotification({
      notification_id: "driver-offer:" + offer.offer_id,
      company_id: offer.company_id,
      delivery_id: offer.delivery_id,
      event_id: offer.offer_id,
      recipient_actor_id: offer.driver_id,
      channel: "WHATSAPP",
      template_key: "DRIVER_OFFER",
      payload_json: JSON.stringify({ offer_id: offer.offer_id, delivery_id: offer.delivery_id, expires_at: offer.expires_at }),
      status: "PENDING", attempt_count: 0, next_attempt_at: "", lease_until: "",
      last_error_code: "", provider_message_id: "", created_at: offer.created_at, updated_at: offer.created_at
    });
  }
  function sameRequest(offer, input, companyId) {
    return offer && offer.company_id === companyId && offer.delivery_id === input.delivery_id &&
      offer.driver_id === input.driver_id && offer.request_key === input.idempotency_key;
  }

  function createOffer(input, actor) {
    return exclusive(function () {
      if (!input || !isNonEmptyString(input.delivery_id) || !isNonEmptyString(input.driver_id) ||
          !isNonEmptyString(input.idempotency_key) || input.idempotency_key.length > 100) {
        throw new FikishaError("INVALID_DRIVER_OFFER_REQUEST");
      }
      var delivery = deps.deliveryService.get(input.delivery_id, actor);
      assertActor(actor, delivery.company_id, ["DISPATCHER", "SYSTEM"]);
      if (!store.isActiveDriver(input.driver_id, delivery.company_id)) throw new FikishaError("ACTIVE_COMPANY_DRIVER_REQUIRED");
      var prior = store.getOfferByRequestKey(delivery.company_id, input.idempotency_key);
      var offer;
      if (prior) {
        if (!sameRequest(prior, input, delivery.company_id)) throw new FikishaError("DRIVER_OFFER_REQUEST_KEY_REUSED");
        offer = prior;
        if (offer.status !== "OFFERED") return offer;
      } else {
        if (delivery.status !== "DISPATCH_PENDING") throw new FikishaError("DELIVERY_NOT_DISPATCH_PENDING");
        var active = store.listOffersForDelivery(delivery.delivery_id).find(function (item) { return item.status === "OFFERED"; });
        if (active) throw new FikishaError("ACTIVE_DRIVER_OFFER_EXISTS");
        var nowMs = now();
        var expiry = input.expires_at ? new Date(input.expires_at).getTime() : nowMs + ttlMs;
        if (!Number.isFinite(expiry) || expiry <= nowMs || expiry > nowMs + ttlMs) throw new FikishaError("INVALID_OFFER_EXPIRY");
        offer = {
          offer_id: deps.idFactory(), company_id: delivery.company_id, delivery_id: delivery.delivery_id,
          driver_id: input.driver_id, status: "OFFERED", expires_at: iso(expiry), created_at: iso(nowMs),
          responded_at: "", response_actor_id: "", request_key: input.idempotency_key,
          attempt_number: store.listOffersForDelivery(delivery.delivery_id).length + 1
        };
        offer = store.createOffer(offer).offer;
      }

      var current = deps.deliveryService.get(offer.delivery_id, actor);
      if (current.status === "DISPATCH_PENDING") {
        deps.deliveryService.transition({
          delivery_id: offer.delivery_id, action: "OFFER_TO_DRIVER",
          idempotency_key: "offer-send:" + offer.request_key
        }, actor);
      } else if (current.status === "ASSIGNED" && current.driver_id === offer.driver_id && offer.status === "OFFERED") {
        offer.status = "ACCEPTED";
        offer.responded_at = iso(now());
        offer.response_actor_id = offer.driver_id;
        store.updateOffer(offer, "OFFERED");
      } else if (current.status !== "OFFER_SENT" && current.status !== "ASSIGNED") {
        throw new FikishaError("OFFER_DELIVERY_STATE_CONFLICT");
      }
      if (offer.status === "OFFERED") enqueueOfferNotification(offer);
      return offer;
    });
  }

  function respond(input, actor) {
    return exclusive(function () {
      if (!input || !isNonEmptyString(input.offer_id) || !["ACCEPT", "DECLINE"].includes(input.response) ||
          !isNonEmptyString(input.idempotency_key) || input.idempotency_key.length > 100) {
        throw new FikishaError("INVALID_OFFER_RESPONSE");
      }
      var offer = store.getOffer(input.offer_id);
      if (!offer) throw new FikishaError("DRIVER_OFFER_NOT_FOUND");
      assertActor(actor, offer.company_id, ["DRIVER"]);
      if (actor.actor_id !== offer.driver_id) throw new FikishaError("OFFER_DRIVER_MISMATCH");
      if (!store.isActiveDriver(actor.actor_id, offer.company_id)) throw new FikishaError("ACTIVE_COMPANY_DRIVER_REQUIRED");
      if (offer.status === "ACCEPTED" && input.response === "ACCEPT" && offer.response_actor_id === actor.actor_id) {
        return deps.deliveryService.get(offer.delivery_id, actor);
      }
      if (offer.status === "DECLINED" && input.response === "DECLINE" && offer.response_actor_id === actor.actor_id) {
        return deps.deliveryService.get(offer.delivery_id, actor);
      }
      if (offer.status !== "OFFERED") throw new FikishaError("DRIVER_OFFER_NOT_OPEN");
      if (now() >= new Date(offer.expires_at).getTime()) throw new FikishaError("DRIVER_OFFER_EXPIRED");
      var delivery = deps.deliveryService.get(offer.delivery_id, actor);
      var action = input.response === "ACCEPT" ? "ACCEPT_OFFER" : "DECLINE_OFFER";
      var responseKey = "offer-response:" + offer.offer_id + ":" + input.response;
      if (input.response === "ACCEPT" && delivery.status === "ASSIGNED" && delivery.driver_id === actor.actor_id) {
        offer.status = "ACCEPTED"; offer.responded_at = iso(now()); offer.response_actor_id = actor.actor_id;
        store.updateOffer(offer, "OFFERED");
        return delivery;
      }
      if (input.response === "DECLINE" && delivery.status === "DISPATCH_PENDING") {
        var recoveredDecline = deps.deliveryService.transition({
          delivery_id: offer.delivery_id, action: action, driver_id: actor.actor_id,
          idempotency_key: responseKey, reason: ""
        }, actor);
        offer.status = "DECLINED"; offer.responded_at = iso(now()); offer.response_actor_id = actor.actor_id;
        store.updateOffer(offer, "OFFERED");
        return recoveredDecline;
      }
      if (delivery.status !== "OFFER_SENT") throw new FikishaError("OFFER_DELIVERY_STATE_CONFLICT");
      var updated = deps.deliveryService.transition({
        delivery_id: offer.delivery_id, action: action, driver_id: actor.actor_id,
        idempotency_key: responseKey, reason: ""
      }, actor);
      offer.status = input.response === "ACCEPT" ? "ACCEPTED" : "DECLINED";
      offer.responded_at = iso(now()); offer.response_actor_id = actor.actor_id;
      store.updateOffer(offer, "OFFERED");
      return updated;
    });
  }

  function expireOffer(offerId, systemActor) {
    return exclusive(function () {
      var offer = store.getOffer(offerId);
      if (!offer) throw new FikishaError("DRIVER_OFFER_NOT_FOUND");
      assertActor(systemActor, offer.company_id, ["SYSTEM"]);
      if (offer.status === "EXPIRED") return deps.deliveryService.get(offer.delivery_id, systemActor);
      if (offer.status !== "OFFERED") throw new FikishaError("DRIVER_OFFER_NOT_OPEN");
      if (now() < new Date(offer.expires_at).getTime()) throw new FikishaError("DRIVER_OFFER_NOT_EXPIRED");
      var delivery = deps.deliveryService.get(offer.delivery_id, systemActor);
      if (delivery.status !== "OFFER_SENT" && delivery.status !== "DISPATCH_PENDING") {
        throw new FikishaError("OFFER_DELIVERY_STATE_CONFLICT");
      }
      var updated = deps.deliveryService.transition({
        delivery_id: offer.delivery_id, action: "EXPIRE_OFFER",
        idempotency_key: "offer-expire:" + offer.offer_id
      }, systemActor);
      offer.status = "EXPIRED"; offer.responded_at = iso(now()); offer.response_actor_id = systemActor.actor_id;
      store.updateOffer(offer, "OFFERED");
      return updated;
    });
  }
  return Object.freeze({ createOffer: createOffer, respond: respond, expireOffer: expireOffer });
}
