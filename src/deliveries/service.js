function createDeliveryService(deps) {
  if (!deps || !deps.store || !deps.clock || !deps.idFactory) throw new FikishaError("SERVICE_DEPENDENCIES_REQUIRED");
  var store=deps.store;
  function actorCheck(actor, companyId) {
    if (!actor || actor.active !== true || actor.company_id !== companyId) throw new FikishaError("TENANT_ACCESS_DENIED");
    if (actor.role === "DEVELOPER") throw new FikishaError("DEVELOPER_DELIVERY_ACCESS_DENIED");
  }
  function create(input, actor, idempotencyKey) {
    if (!actor || !actor.company_id || !actor.active || !["COMPANY_ADMIN","DISPATCHER"].includes(actor.role)) throw new FikishaError("DELIVERY_CREATE_FORBIDDEN");
    var validation=validateDeliveryInput(input);
    if (!validation.ok) throw new FikishaError("DELIVERY_VALIDATION_FAILED", validation.errors.join(","));
    if (!isNonEmptyString(idempotencyKey) || idempotencyKey.length>128) throw new FikishaError("IDEMPOTENCY_KEY_REQUIRED");
    var key=actor.company_id+":"+idempotencyKey, prior=store.getIdempotency(key);
    if (prior) return prior.result;
    var now=deps.clock().toISOString();
    var d={delivery_id:deps.idFactory(),company_id:actor.company_id,status:"RECEIVED",
      sender_name:input.sender_name.trim(),sender_phone:input.sender_phone,recipient_name:input.recipient_name.trim(),
      recipient_phone:input.recipient_phone,pickup_text:input.pickup_text.trim(),dropoff_text:input.dropoff_text.trim(),
      instructions:isNonEmptyString(input.instructions)?input.instructions.trim():"",consent_status:input.consent_status,
      created_at:now,updated_at:now,created_by:actor.actor_id,version:1};
    store.insertDelivery(d);
    store.appendEvent({event_id:deps.idFactory(),company_id:actor.company_id,delivery_id:d.delivery_id,event_type:"DELIVERY_CREATED",
      actor_id:actor.actor_id,from_status:"",to_status:"RECEIVED",created_at:now});
    store.saveIdempotency(key,{result:d,created_at:now});
    return d;
  }
  function transition(args, actor) {
    if (!args || !isNonEmptyString(args.delivery_id) || !isNonEmptyString(args.action)) throw new FikishaError("INVALID_TRANSITION_REQUEST");
    var current=store.getDelivery(args.delivery_id);
    if (!current) throw new FikishaError("DELIVERY_NOT_FOUND");
    actorCheck(actor,current.company_id);
    var decision=decideTransition(current.status,args.action,actor.role);
    if (!decision.ok) throw new FikishaError(decision.reason_code||"INVALID_TRANSITION");
    if (decision.to==="DELIVERED_VERIFIED" && (!isNonEmptyString(args.proof_id)||!store.isProofVerified(args.proof_id,current.delivery_id,current.company_id))) throw new FikishaError("VERIFIED_PROOF_REQUIRED");
    if (decision.to==="ASSIGNED" && (!isNonEmptyString(args.driver_id)||!store.isActiveDriver(args.driver_id,current.company_id))) throw new FikishaError("ACTIVE_COMPANY_DRIVER_REQUIRED");
    if (decision.to==="DELIVERY_ATTEMPTED" && !isNonEmptyString(args.reason)) throw new FikishaError("FAILURE_REASON_REQUIRED");
    var now=deps.clock().toISOString(), updated=Object.assign({},current,{status:decision.to,updated_at:now,version:Number(current.version||0)+1});
    if(decision.to==="ASSIGNED") updated.driver_id=args.driver_id;
    if(decision.to==="DELIVERED_VERIFIED"){updated.proof_id=args.proof_id;updated.delivered_at=now;}
    if(decision.to==="DELIVERY_ATTEMPTED") updated.failure_reason=args.reason.trim();
    store.saveDelivery(updated,current.version);
    store.appendEvent({event_id:deps.idFactory(),company_id:current.company_id,delivery_id:current.delivery_id,event_type:args.action,
      actor_id:actor.actor_id,from_status:current.status,to_status:decision.to,reason:args.reason||"",proof_id:args.proof_id||"",created_at:now});
    return updated;
  }
  function get(id,actor){var d=store.getDelivery(id);if(!d)throw new FikishaError("DELIVERY_NOT_FOUND");actorCheck(actor,d.company_id);return d;}
  return Object.freeze({create:create,transition:transition,get:get});
}