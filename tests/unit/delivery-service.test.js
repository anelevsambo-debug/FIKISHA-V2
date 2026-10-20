const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const c = vm.createContext({});
for (const file of ['errors.js', 'ids.js', 'validators.js', 'permissions.js', 'stateMachine.js', 'tenants.js', 'actorResolver.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/core', file), 'utf8'), c);
}
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/deliveries/service.js'), 'utf8'), c);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/deliveries/dispatchService.js'), 'utf8'), c);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/notifications/outboxService.js'), 'utf8'), c);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/deliveries/proofOfDeliveryService.js'), 'utf8'), c);

function fixture() {
  const db = { deliveries: new Map(), events: [], keys: new Map(), proofs: new Set(), proofRecords: new Map(), challenges: new Map(), proofEvidence: new Map(), driveFiles: new Map(), drivers: new Set(), offers: new Map(), outbox: new Map() };
  let nowMs = Date.parse('2026-10-20T00:00:00Z');
  const store = {
    runExclusive: work => work(),
    getOffer: id => db.offers.has(id) ? Object.assign({}, db.offers.get(id)) : null,
    getOfferByRequestKey: (company, key) => { const o = Array.from(db.offers.values()).find(o => o.company_id === company && o.request_key === key); return o ? Object.assign({}, o) : null; },
    listOffersForDelivery: id => Array.from(db.offers.values()).filter(o => o.delivery_id === id).map(o => Object.assign({}, o)),
    createOffer(offer) {
      const prior = db.offers.get(offer.offer_id) || this.getOfferByRequestKey(offer.company_id, offer.request_key);
      if (prior) {
        if (prior.company_id !== offer.company_id || prior.delivery_id !== offer.delivery_id || prior.driver_id !== offer.driver_id || prior.request_key !== offer.request_key) {
          throw Object.assign(new Error('offer conflict'), { code: 'DRIVER_OFFER_ID_CONFLICT' });
        }
        return { created: false, offer: Object.assign({}, prior) };
      }
      db.offers.set(offer.offer_id, Object.assign({}, offer));
      return { created: true, offer: Object.assign({}, db.offers.get(offer.offer_id)) };
    },
    updateOffer(offer, expectedStatus) {
      const prior = db.offers.get(offer.offer_id);
      if (!prior) throw Object.assign(new Error('missing offer'), { code: 'DRIVER_OFFER_NOT_FOUND' });
      if (expectedStatus && prior.status !== expectedStatus) throw Object.assign(new Error('offer status conflict'), { code: 'DRIVER_OFFER_STATUS_CONFLICT' });
      db.offers.set(offer.offer_id, Object.assign({}, offer));
      return offer;
    },
    enqueueNotification(n) {
      const prior = db.outbox.get(n.notification_id);
      if (prior) return { created: false, notification: prior };
      db.outbox.set(n.notification_id, Object.assign({}, n));
      return { created: true, notification: db.outbox.get(n.notification_id) };
    },
    getNotification: id => db.outbox.has(id) ? Object.assign({}, db.outbox.get(id)) : null,
    listDueNotifications(now, limit) {
      return Array.from(db.outbox.values()).filter(n =>
        (n.status === 'PENDING' || n.status === 'RETRY') &&
        (!n.next_attempt_at || n.next_attempt_at <= now) ||
        (n.status === 'PROCESSING' && n.lease_until && n.lease_until <= now)
      ).slice(0, limit).map(n => Object.assign({}, n));
    },
    claimNotification(id, now, lease) {
      const n = db.outbox.get(id);
      if (!n) throw Object.assign(new Error('missing notification'), { code: 'NOTIFICATION_NOT_FOUND' });
      if (n.status === 'PROCESSING' && n.lease_until > now) return null;
      if (!['PENDING', 'RETRY'].includes(n.status) && !(n.status === 'PROCESSING' && n.lease_until <= now)) return null;
      n.status = 'PROCESSING'; n.attempt_count = Number(n.attempt_count || 0) + 1; n.lease_until = lease;
      return Object.assign({}, n);
    },
    updateNotification(n, expectedStatus) {
      const prior = db.outbox.get(n.notification_id);
      if (expectedStatus && prior.status !== expectedStatus) throw Object.assign(new Error('notification status conflict'), { code: 'NOTIFICATION_STATUS_CONFLICT' });
      db.outbox.set(n.notification_id, Object.assign({}, n));
      return n;
    },
    getDelivery: id => db.deliveries.get(id) || null,
    insertDelivery: d => {
      if (db.deliveries.has(d.delivery_id)) throw Object.assign(new Error('conflict'), { code: 'DELIVERY_ID_CONFLICT' });
      db.deliveries.set(d.delivery_id, d);
    },
    ensureDelivery: d => {
      const prior = db.deliveries.get(d.delivery_id);
      if (prior) return { created: false, delivery: prior };
      db.deliveries.set(d.delivery_id, d);
      return { created: true, delivery: d };
    },
    saveDelivery: (d, version) => {
      const old = db.deliveries.get(d.delivery_id);
      if (!old || old.version !== version) throw Object.assign(new Error('conflict'), { code: 'CONCURRENT_UPDATE' });
      db.deliveries.set(d.delivery_id, d);
    },
    appendEvent: e => db.events.push(e),
    ensureEvent: e => {
      const prior = db.events.find(x => x.event_id === e.event_id);
      if (prior) return { created: false, event: prior };
      db.events.push(e);
      return { created: true, event: e };
    },
    getIdempotency: key => db.keys.get(key) || null,
    saveIdempotency: (key, value) => db.keys.set(key, value),
    reserveIdempotency: (key, candidate) => {
      const prior = db.keys.get(key);
      if (prior) return { created: false, record: prior };
      db.keys.set(key, candidate);
      return { created: true, record: candidate };
    },
    completeIdempotency: (key, record) => {
      if (!db.keys.has(key)) throw Object.assign(new Error('reservation missing'), { code: 'IDEMPOTENCY_RESERVATION_MISSING' });
      db.keys.set(key, record);
    },
    isProofVerified: (proof, delivery, company) => {
      if (db.proofs.has([proof, delivery, company].join(':'))) return true;
      const record = db.proofRecords.get(proof);
      if (!record || record.delivery_id !== delivery || record.company_id !== company || record.verified !== true) return false;
      const challenge = db.challenges.get(record.challenge_id);
      if (!challenge || challenge.proof_id !== proof || !['COMPLETING', 'CONSUMED'].includes(challenge.status)) return false;
      const ids = JSON.parse(challenge.evidence_ids_json || '[]');
      return ids.length > 0 && ids.every(id => {
        const evidence = db.proofEvidence.get(id);
        return evidence && evidence.delivery_id === delivery && evidence.company_id === company &&
          evidence.challenge_id === challenge.challenge_id && evidence.verified === true;
      }) && ids.some(id => db.proofEvidence.get(id).evidence_type === 'DELIVERY_PHOTO');
    },
    getChallenge: id => db.challenges.has(id) ? Object.assign({}, db.challenges.get(id)) : null,
    listChallengesForDelivery: id => Array.from(db.challenges.values()).filter(x => x.delivery_id === id).map(x => Object.assign({}, x)),
    createChallenge(challenge) {
      if (db.challenges.has(challenge.challenge_id)) throw Object.assign(new Error('duplicate challenge'), { code: 'PROOF_CHALLENGE_ID_CONFLICT' });
      db.challenges.set(challenge.challenge_id, Object.assign({}, challenge));
      return challenge;
    },
    updateChallenge(challenge, expectedStatus) {
      const prior = db.challenges.get(challenge.challenge_id);
      if (!prior) throw Object.assign(new Error('missing challenge'), { code: 'PROOF_CHALLENGE_NOT_FOUND' });
      if (expectedStatus && prior.status !== expectedStatus) throw Object.assign(new Error('challenge status conflict'), { code: 'PROOF_CHALLENGE_STATUS_CONFLICT' });
      if (prior.delivery_id !== challenge.delivery_id || prior.company_id !== challenge.company_id) throw Object.assign(new Error('binding conflict'), { code: 'PROOF_CHALLENGE_BINDING_CONFLICT' });
      db.challenges.set(challenge.challenge_id, Object.assign({}, challenge));
      return challenge;
    },
    invalidateChallenge(id, reason, at) {
      const prior = db.challenges.get(id);
      if (!prior) throw Object.assign(new Error('missing challenge'), { code: 'PROOF_CHALLENGE_NOT_FOUND' });
      if (prior.status === 'COMPLETING') throw Object.assign(new Error('recovery required'), { code: 'PROOF_COMPLETION_RECOVERY_REQUIRED' });
      if (['CONSUMED', 'INVALIDATED'].includes(prior.status)) return prior;
      return this.updateChallenge(Object.assign({}, prior, { status: 'INVALIDATED', invalidation_reason: reason, invalidated_at: at, updated_at: at }), 'ACTIVE');
    },
    registerProofEvidence(evidence) {
      const prior = db.proofEvidence.get(evidence.evidence_id);
      if (prior) {
        if (prior.drive_file_id !== evidence.drive_file_id || prior.delivery_id !== evidence.delivery_id || prior.company_id !== evidence.company_id) throw Object.assign(new Error('evidence conflict'), { code: 'PROOF_EVIDENCE_ID_CONFLICT' });
        return prior;
      }
      if (Array.from(db.proofEvidence.values()).some(x => x.drive_file_id === evidence.drive_file_id && x.delivery_id !== evidence.delivery_id)) throw Object.assign(new Error('evidence reuse'), { code: 'DRIVE_EVIDENCE_REUSE_DENIED' });
      db.proofEvidence.set(evidence.evidence_id, Object.assign({}, evidence));
      return evidence;
    },
    getProofEvidence: id => db.proofEvidence.has(id) ? Object.assign({}, db.proofEvidence.get(id)) : null,
    listProofEvidence: id => Array.from(db.proofEvidence.values()).filter(x => x.delivery_id === id),
    createProofRecord(proof) {
      const prior = db.proofRecords.get(proof.proof_id);
      if (prior && (prior.delivery_id !== proof.delivery_id || prior.company_id !== proof.company_id)) throw Object.assign(new Error('proof conflict'), { code: 'PROOF_RECORD_CONFLICT' });
      if (!prior) db.proofRecords.set(proof.proof_id, Object.assign({}, proof));
      db.proofs.add([proof.proof_id, proof.delivery_id, proof.company_id].join(':'));
      return prior || proof;
    },
    getProofRecord: id => db.proofRecords.has(id) ? Object.assign({}, db.proofRecords.get(id)) : null,
    isActiveDriver: (id, company) => db.drivers.has([id, company].join(':'))
  };

  const identities = new WeakMap();
  const systemPrincipals = new WeakMap();
  const memberships = new Map([
    ['admin-a@example.test', { actor_id: 'admin-1', email: 'admin-a@example.test', company_id: 'CO-A', role: 'COMPANY_ADMIN', active: true }],
    ['other@example.test', { actor_id: 'other', email: 'other@example.test', company_id: 'CO-B', role: 'COMPANY_ADMIN', active: true }],
    ['driver@example.test', { actor_id: 'driver', email: 'driver@example.test', company_id: 'CO-A', role: 'DRIVER', active: true }],
    ['driver2@example.test', { actor_id: 'driver2', email: 'driver2@example.test', company_id: 'CO-A', role: 'DRIVER', active: true }],
    ['dispatcher@example.test', { actor_id: 'dispatcher', email: 'dispatcher@example.test', company_id: 'CO-A', role: 'DISPATCHER', active: true }]
  ]);
  const actorResolver = c.createTrustedActorResolver({
    getAuthenticatedEmail: invocation => identities.get(invocation) || '',
    getAuthenticatedSystemPrincipal: invocation => systemPrincipals.get(invocation) || '',
    membershipStore: { getMembershipByEmail: email => memberships.get(email) || null }
  });
  function invocation(email) {
    const value = {};
    identities.set(value, email);
    return value;
  }
  function systemInvocation() {
    const value = {};
    systemPrincipals.set(value, 'test-expiry-worker');
    return value;
  }

  db.drivers.add('driver:CO-A');
  db.drivers.add('driver2:CO-A');
  let n = 0;
  const clock = () => new Date(nowMs);
  const idFactory = () => 'ID-' + (++n);
  const service = c.createDeliveryService({ store, actorResolver, clock, idFactory });
  const dispatchService = c.createDispatchService({ store, deliveryService: service, actorResolver, clock, idFactory, offerTtlMs: 120000 });
  const outboxService = c.createNotificationOutboxService({
    store, clock, baseDelayMs: 1000, maxAttempts: 3,
    sender: (notification, idempotencyKey) => ({ accepted: true, provider_message_id: 'MSG-' + idempotencyKey })
  });
  return {
    db,
    store,
    actorResolver,
    service,
    dispatchService,
    outboxService,
    actorResolver,
    identities,
    actor: actorResolver.resolve(invocation('admin-a@example.test'), 'CO-A'),
    otherActor: actorResolver.resolve(invocation('other@example.test'), 'CO-B'),
    driver: actorResolver.resolve(invocation('driver@example.test'), 'CO-A'),
    driver2: actorResolver.resolve(invocation('driver2@example.test'), 'CO-A'),
    dispatcher: actorResolver.resolve(invocation('dispatcher@example.test'), 'CO-A'),
    system: actorResolver.resolveSystemActor(systemInvocation(), 'CO-A'),
    setNow(value) { nowMs = Date.parse(value); },
    currentTime() { return nowMs; },
    input: {
      sender_name: 'Sender', sender_phone: '+26770000001',
      recipient_name: 'Recipient', recipient_phone: '+26770000002',
      pickup_text: 'Pickup', dropoff_text: 'Dropoff', consent_status: 'OPTED_IN'
    }
  };
}

test('delivery create persists record and audit event', () => {
  const f = fixture();
  const delivery = f.service.create(f.input, f.actor, 'req-1');
  assert.equal(f.db.deliveries.get(delivery.delivery_id).status, 'RECEIVED');
  assert.equal(f.db.events.length, 1);
});

test('same idempotency key returns same delivery', () => {
  const f = fixture();
  const first = f.service.create(f.input, f.actor, 'req-1');
  const second = f.service.create(f.input, f.actor, 'req-1');
  assert.equal(first.delivery_id, second.delivery_id);
  assert.equal(f.db.deliveries.size, 1);
});

test('cross-company actor cannot read delivery', () => {
  const f = fixture();
  const delivery = f.service.create(f.input, f.actor, 'req-1');
  assert.throws(
    () => f.service.get(delivery.delivery_id, f.otherActor),
    error => error.code === 'TENANT_ACCESS_DENIED'
  );
});

test('driver cannot complete delivery without verified proof', () => {
  const f = fixture();
  const delivery = f.service.create(f.input, f.actor, 'req-1');
  f.db.deliveries.set(delivery.delivery_id, Object.assign({}, delivery, { status: 'DELIVERY_VERIFICATION_PENDING', driver_id: 'driver' }));
  assert.throws(
    () => f.service.transition({ delivery_id: delivery.delivery_id, action: 'VERIFY_OTP', idempotency_key: 'verify-1', proof_id: 'proof-x' }, f.driver),
    error => error.code === 'VERIFIED_PROOF_REQUIRED'
  );
});


test('transition retries return the original result without duplicate audit events', () => {
  const f = fixture();
  const delivery = f.service.create(f.input, f.actor, 'create-transition');
  f.db.deliveries.set(delivery.delivery_id, Object.assign({}, delivery, { status: 'READY_FOR_QUOTE', version: 1 }));
  const request = { delivery_id: delivery.delivery_id, action: 'ISSUE_QUOTE', idempotency_key: 'transition-1' };

  const first = f.service.transition(request, f.actor);
  const retry = f.service.transition(request, f.actor);

  assert.equal(first.status, 'QUOTE_ISSUED');
  assert.equal(first.version, 2);
  assert.equal(retry.status, 'QUOTE_ISSUED');
  assert.equal(retry.version, 2);
  assert.equal(f.db.events.length, 2);
  assert.equal(f.db.keys.get('CO-A:TRANSITION:transition-1').state, 'COMPLETED');
});

test('transition idempotency key cannot be reused for a different action', () => {
  const f = fixture();
  const delivery = f.service.create(f.input, f.actor, 'create-transition');
  f.db.deliveries.set(delivery.delivery_id, Object.assign({}, delivery, { status: 'READY_FOR_QUOTE', version: 1 }));
  f.service.transition({ delivery_id: delivery.delivery_id, action: 'ISSUE_QUOTE', idempotency_key: 'transition-1' }, f.actor);
  assert.throws(
    () => f.service.transition({ delivery_id: delivery.delivery_id, action: 'CANCEL', idempotency_key: 'transition-1' }, f.actor),
    error => error.code === 'IDEMPOTENCY_KEY_REUSED'
  );
});

test('caller-created actor object cannot create a delivery', () => {
  const f = fixture();
  assert.throws(
    () => f.service.create(f.input, { actor_id: 'admin-1', company_id: 'CO-A', role: 'COMPANY_ADMIN', active: true }, 'req-1'),
    error => error.code === 'UNTRUSTED_ACTOR_CONTEXT'
  );
});

test('Company B cannot transition or mutate Company A delivery through a foreign ID', () => {
  const f = fixture();
  const delivery = f.service.create(f.input, f.actor, 'tenant-bound-create');
  const before = Object.assign({}, f.db.deliveries.get(delivery.delivery_id));
  const eventCount = f.db.events.length;

  assert.throws(
    () => f.service.transition({
      delivery_id: delivery.delivery_id,
      action: 'CANCEL',
      idempotency_key: 'cross-tenant-transition'
    }, f.otherActor),
    error => error.code === 'TENANT_ACCESS_DENIED'
  );
  assert.throws(
    () => f.service.get(delivery.delivery_id, f.otherActor),
    error => error.code === 'TENANT_ACCESS_DENIED'
  );
  assert.equal(JSON.stringify(f.db.deliveries.get(delivery.delivery_id)), JSON.stringify(before));
  assert.equal(f.db.events.length, eventCount);
});

test('proof belonging to another company cannot authorize Company A delivery completion', () => {
  const f = fixture();
  const delivery = f.service.create(f.input, f.actor, 'tenant-proof-create');
  f.db.deliveries.set(delivery.delivery_id, Object.assign({}, delivery, {
    status: 'DELIVERY_VERIFICATION_PENDING', driver_id: 'driver'
  }));
  f.db.proofs.add(['proof-from-b', delivery.delivery_id, 'CO-B'].join(':'));

  assert.throws(
    () => f.service.transition({
      delivery_id: delivery.delivery_id,
      action: 'VERIFY_OTP',
      idempotency_key: 'foreign-proof-attempt',
      proof_id: 'proof-from-b'
    }, f.driver),
    error => error.code === 'VERIFIED_PROOF_REQUIRED'
  );
});


function prepareDispatch(f, key) {
  const delivery = f.service.create(f.input, f.actor, 'create-' + key);
  f.service.transition({ delivery_id: delivery.delivery_id, action: 'VALIDATE_OK', idempotency_key: 'validate-' + key }, f.dispatcher);
  f.service.transition({ delivery_id: delivery.delivery_id, action: 'ISSUE_QUOTE', idempotency_key: 'quote-' + key }, f.dispatcher);
  const pending = f.service.transition({ delivery_id: delivery.delivery_id, action: 'ACCEPT_QUOTE', idempotency_key: 'accept-quote-' + key }, f.dispatcher);
  assert.equal(pending.status, 'DISPATCH_PENDING');
  return pending;
}

test('synthetic lifecycle reaches IN_TRANSIT through durable offer acceptance and collection', () => {
  const f = fixture();
  const pending = prepareDispatch(f, 'journey');
  const offer = f.dispatchService.createOffer({
    delivery_id: pending.delivery_id, driver_id: 'driver', idempotency_key: 'offer-journey'
  }, f.dispatcher);
  assert.equal(f.db.offers.get(offer.offer_id).status, 'OFFERED');
  assert.equal(f.db.deliveries.get(pending.delivery_id).status, 'OFFER_SENT');
  assert.equal(f.db.outbox.get('driver-offer:' + offer.offer_id).status, 'PENDING');

  const assigned = f.dispatchService.respond({
    offer_id: offer.offer_id, response: 'ACCEPT', idempotency_key: 'accept-journey'
  }, f.driver);
  assert.equal(assigned.status, 'ASSIGNED');
  assert.equal(assigned.driver_id, 'driver');
  assert.equal(f.db.offers.get(offer.offer_id).status, 'ACCEPTED');
  const assignmentEvent = f.db.events.find(event => event.event_type === 'ACCEPT_OFFER' && event.delivery_id === pending.delivery_id);
  assert.equal(assignmentEvent.actor_id, 'driver');
  assert.equal(assignmentEvent.from_status, 'OFFER_SENT');
  assert.equal(assignmentEvent.to_status, 'ASSIGNED');
  assert.equal(assignmentEvent.created_at, '2026-10-20T00:00:00.000Z');

  const collected = f.service.transition({
    delivery_id: pending.delivery_id, action: 'CONFIRM_COLLECTION', idempotency_key: 'collect-journey'
  }, f.driver);
  assert.equal(collected.status, 'COLLECTED');
  const transit = f.service.transition({
    delivery_id: pending.delivery_id, action: 'START_TRANSIT', idempotency_key: 'transit-journey'
  }, f.driver);
  assert.equal(transit.status, 'IN_TRANSIT');
  assert.equal(f.db.deliveries.get(pending.delivery_id).status, 'IN_TRANSIT');
});

test('invalid offer state and cancellation after dispatch are rejected by approved state machine', () => {
  const f = fixture();
  const delivery = f.service.create(f.input, f.actor, 'invalid-offer-create');
  assert.throws(() => f.dispatchService.createOffer({
    delivery_id: delivery.delivery_id, driver_id: 'driver', idempotency_key: 'too-early'
  }, f.dispatcher), error => error.code === 'DELIVERY_NOT_DISPATCH_PENDING');

  const pending = prepareDispatch(f, 'cancel-after-dispatch');
  const offer = f.dispatchService.createOffer({
    delivery_id: pending.delivery_id, driver_id: 'driver', idempotency_key: 'cancel-offer'
  }, f.dispatcher);
  assert.throws(() => f.service.transition({
    delivery_id: pending.delivery_id, action: 'CANCEL', idempotency_key: 'cancel-dispatched'
  }, f.dispatcher), error => error.code === 'INVALID_TRANSITION');
  assert.equal(f.db.offers.get(offer.offer_id).status, 'OFFERED');
});

test('competing driver responses cannot assign one delivery twice', async () => {
  const f = fixture();
  const pending = prepareDispatch(f, 'race');
  const offer = f.dispatchService.createOffer({
    delivery_id: pending.delivery_id, driver_id: 'driver', idempotency_key: 'offer-race'
  }, f.dispatcher);
  const results = await Promise.allSettled([
    Promise.resolve().then(() => f.dispatchService.respond({
      offer_id: offer.offer_id, response: 'ACCEPT', idempotency_key: 'driver-accept'
    }, f.driver)),
    Promise.resolve().then(() => f.dispatchService.respond({
      offer_id: offer.offer_id, response: 'ACCEPT', idempotency_key: 'driver2-accept'
    }, f.driver2))
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.equal(f.db.deliveries.get(pending.delivery_id).status, 'ASSIGNED');
  assert.equal(f.db.deliveries.get(pending.delivery_id).driver_id, 'driver');
  assert.equal(f.db.offers.get(offer.offer_id).status, 'ACCEPTED');
});

test('repeated acceptance and duplicate offer request do not repeat transitions or notifications', () => {
  const f = fixture();
  const pending = prepareDispatch(f, 'duplicates');
  const request = { delivery_id: pending.delivery_id, driver_id: 'driver', idempotency_key: 'offer-duplicate' };
  const firstOffer = f.dispatchService.createOffer(request, f.dispatcher);
  const eventCount = f.db.events.length;
  const secondOffer = f.dispatchService.createOffer(request, f.dispatcher);
  assert.equal(secondOffer.offer_id, firstOffer.offer_id);
  assert.equal(f.db.outbox.has('driver-offer:' + firstOffer.offer_id), true);

  f.dispatchService.respond({ offer_id: firstOffer.offer_id, response: 'ACCEPT', idempotency_key: 'accept-1' }, f.driver);
  const afterAcceptEvents = f.db.events.length;
  const replay = f.dispatchService.respond({ offer_id: firstOffer.offer_id, response: 'ACCEPT', idempotency_key: 'accept-2' }, f.driver);
  assert.equal(replay.status, 'ASSIGNED');
  assert.equal(f.db.events.length, afterAcceptEvents);
  assert.ok(afterAcceptEvents >= eventCount);
  assert.equal(Array.from(f.db.outbox.keys()).filter(id => id === 'driver-offer:' + firstOffer.offer_id).length, 1);
});

test('expired offer returns delivery to DISPATCH_PENDING and allows deterministic reoffer', () => {
  const f = fixture();
  const pending = prepareDispatch(f, 'expiry');
  const offer = f.dispatchService.createOffer({
    delivery_id: pending.delivery_id, driver_id: 'driver', idempotency_key: 'offer-expiry'
  }, f.dispatcher);
  f.setNow(offer.expires_at);
  assert.throws(() => f.dispatchService.respond({
    offer_id: offer.offer_id, response: 'ACCEPT', idempotency_key: 'late-accept'
  }, f.driver), error => error.code === 'DRIVER_OFFER_EXPIRED');
  const returned = f.dispatchService.expireOffer(offer.offer_id, f.system);
  assert.equal(returned.status, 'DISPATCH_PENDING');
  assert.equal(f.db.offers.get(offer.offer_id).status, 'EXPIRED');

  const reoffer = f.dispatchService.createOffer({
    delivery_id: pending.delivery_id, driver_id: 'driver2', idempotency_key: 'offer-reoffer'
  }, f.dispatcher);
  assert.equal(reoffer.status, 'OFFERED');
  assert.equal(f.db.deliveries.get(pending.delivery_id).status, 'OFFER_SENT');
});

test('notification provider acceptance is not treated as delivery and duplicate confirmation is safe', () => {
  const f = fixture();
  const pending = prepareDispatch(f, 'notification-status');
  const offer = f.dispatchService.createOffer({
    delivery_id: pending.delivery_id, driver_id: 'driver', idempotency_key: 'notification-offer'
  }, f.dispatcher);
  const notificationId = 'driver-offer:' + offer.offer_id;
  const results = f.outboxService.drain(20);
  assert.ok(results.some(r => r.notification_id === notificationId && r.status === 'SENT_TO_PROVIDER'));
  assert.equal(f.db.outbox.get(notificationId).status, 'SENT_TO_PROVIDER');
  assert.notEqual(f.db.outbox.get(notificationId).status, 'DELIVERY_CONFIRMED');

  const confirmed = f.outboxService.recordDeliveryStatus(notificationId, 'DELIVERY_CONFIRMED',
    f.db.outbox.get(notificationId).provider_message_id, '2026-10-20T00:00:05.000Z');
  const duplicate = f.outboxService.recordDeliveryStatus(notificationId, 'DELIVERY_CONFIRMED',
    f.db.outbox.get(notificationId).provider_message_id, '2026-10-20T00:00:06.000Z');
  assert.equal(confirmed.status, 'DELIVERY_CONFIRMED');
  assert.equal(duplicate.status, 'DELIVERY_CONFIRMED');
});

test('notification retries are bounded and exhausted sends become FAILED', () => {
  const f = fixture();
  f.store.enqueueNotification({
    notification_id: 'N-RETRY', company_id: 'CO-A', delivery_id: 'D-X', event_id: 'E-X',
    recipient_actor_id: 'driver', channel: 'WHATSAPP', template_key: 'TEST',
    payload_json: '{}', status: 'PENDING', attempt_count: 0, next_attempt_at: '', lease_until: '',
    last_error_code: '', provider_message_id: '', created_at: '2026-10-20T00:00:00.000Z',
    updated_at: '2026-10-20T00:00:00.000Z'
  });
  const logs = [];
  const failing = c.createNotificationOutboxService({
    store: f.store, clock: () => new Date(f.currentTime()),
    maxAttempts: 3, baseDelayMs: 1000, logger: event => logs.push(event),
    sender: () => { throw Object.assign(new Error('provider secret detail'), { code: 'PROVIDER_TEMPORARY' }); }
  });
  failing.drain(20);
  assert.equal(f.db.outbox.get('N-RETRY').status, 'RETRY');
  for (let attempt = 2; attempt <= 3; attempt += 1) {
    f.setNow(f.db.outbox.get('N-RETRY').next_attempt_at);
    failing.drain(20);
  }
  assert.equal(f.db.outbox.get('N-RETRY').attempt_count, 3);
  assert.equal(f.db.outbox.get('N-RETRY').status, 'FAILED');
  assert.equal(JSON.stringify(logs).includes('provider secret detail'), false);
});

test('outbox recovers a notification left PROCESSING after its lease expires', () => {
  const f = fixture();
  f.store.enqueueNotification({
    notification_id: 'N-INTERRUPTED', company_id: 'CO-A', delivery_id: 'D-X', event_id: 'E-X',
    recipient_actor_id: 'driver', channel: 'WHATSAPP', template_key: 'TEST',
    payload_json: '{}', status: 'PROCESSING', attempt_count: 1, next_attempt_at: '',
    lease_until: '2026-10-20T00:00:01.000Z', last_error_code: '', provider_message_id: '',
    created_at: '2026-10-20T00:00:00.000Z', updated_at: '2026-10-20T00:00:00.000Z'
  });
  f.setNow('2026-10-20T00:00:02.000Z');
  const result = f.outboxService.drain(20);
  assert.ok(result.some(r => r.notification_id === 'N-INTERRUPTED' && r.status === 'SENT_TO_PROVIDER'));
  assert.equal(f.db.outbox.get('N-INTERRUPTED').attempt_count, 2);
});


test('driver decline returns dispatch to pending and a new offer can be issued', () => {
  const f = fixture();
  const pending = prepareDispatch(f, 'decline-reoffer');
  const offer = f.dispatchService.createOffer({
    delivery_id: pending.delivery_id, driver_id: 'driver', idempotency_key: 'offer-decline'
  }, f.dispatcher);
  const declined = f.dispatchService.respond({
    offer_id: offer.offer_id, response: 'DECLINE', idempotency_key: 'decline-1'
  }, f.driver);
  assert.equal(declined.status, 'DISPATCH_PENDING');
  assert.equal(f.db.offers.get(offer.offer_id).status, 'DECLINED');
  const second = f.dispatchService.createOffer({
    delivery_id: pending.delivery_id, driver_id: 'driver2', idempotency_key: 'offer-after-decline'
  }, f.dispatcher);
  assert.equal(second.status, 'OFFERED');
  assert.equal(f.db.deliveries.get(pending.delivery_id).status, 'OFFER_SENT');
});

test('only the assigned driver may confirm collection or start transit', () => {
  const f = fixture();
  const pending = prepareDispatch(f, 'assigned-driver-check');
  const offer = f.dispatchService.createOffer({
    delivery_id: pending.delivery_id, driver_id: 'driver', idempotency_key: 'offer-assigned-driver'
  }, f.dispatcher);
  f.dispatchService.respond({ offer_id: offer.offer_id, response: 'ACCEPT', idempotency_key: 'accept-assigned-driver' }, f.driver);
  assert.throws(() => f.service.transition({
    delivery_id: pending.delivery_id, action: 'CONFIRM_COLLECTION', idempotency_key: 'wrong-driver-collect'
  }, f.driver2), error => error.code === 'ASSIGNED_DRIVER_REQUIRED');
  assert.equal(f.db.deliveries.get(pending.delivery_id).status, 'ASSIGNED');
});

test('replaying an expired offer request does not reopen the old offer', () => {
  const f = fixture();
  const pending = prepareDispatch(f, 'expired-key-replay');
  const request = { delivery_id: pending.delivery_id, driver_id: 'driver', idempotency_key: 'old-offer-key' };
  const offer = f.dispatchService.createOffer(request, f.dispatcher);
  f.setNow(offer.expires_at);
  f.dispatchService.expireOffer(offer.offer_id, f.system);
  const replay = f.dispatchService.createOffer(request, f.dispatcher);
  assert.equal(replay.offer_id, offer.offer_id);
  assert.equal(replay.status, 'EXPIRED');
  assert.equal(f.db.deliveries.get(pending.delivery_id).status, 'DISPATCH_PENDING');
});


test('retry recovers a persisted offer when the lifecycle transition initially fails', () => {
  const f = fixture();
  const pending = prepareDispatch(f, 'offer-partial-create');
  const originalTransition = f.service.transition;
  let failOnce = true;
  const interruptedService = {
    get: f.service.get,
    transition(args, actor) {
      if (args.action === 'OFFER_TO_DRIVER' && failOnce) {
        failOnce = false;
        throw Object.assign(new Error('simulated interruption'), { code: 'SIMULATED_TRANSITION_INTERRUPTION' });
      }
      return originalTransition(args, actor);
    }
  };
  const interruptedDispatch = c.createDispatchService({
    store: f.store, deliveryService: interruptedService, actorResolver: f.actorResolver,
    clock: () => new Date(f.currentTime()), idFactory: () => 'INTERRUPTED-OFFER', offerTtlMs: 120000
  });
  const request = { delivery_id: pending.delivery_id, driver_id: 'driver', idempotency_key: 'offer-partial' };
  assert.throws(() => interruptedDispatch.createOffer(request, f.dispatcher),
    error => error.code === 'SIMULATED_TRANSITION_INTERRUPTION');
  assert.equal(f.db.offers.size, 1);
  assert.equal(f.db.deliveries.get(pending.delivery_id).status, 'DISPATCH_PENDING');

  const recovered = interruptedDispatch.createOffer(request, f.dispatcher);
  assert.equal(recovered.status, 'OFFERED');
  assert.equal(f.db.deliveries.get(pending.delivery_id).status, 'OFFER_SENT');
  assert.equal(f.db.offers.size, 1);
  assert.equal(f.db.outbox.get('driver-offer:' + recovered.offer_id).status, 'PENDING');
});

test('retry repairs offer status when assignment committed before offer record update failed', () => {
  const f = fixture();
  const pending = prepareDispatch(f, 'offer-partial-accept');
  const offer = f.dispatchService.createOffer({
    delivery_id: pending.delivery_id, driver_id: 'driver', idempotency_key: 'offer-partial-accept'
  }, f.dispatcher);
  const originalUpdate = f.store.updateOffer.bind(f.store);
  let failOnce = true;
  f.store.updateOffer = function (value, expectedStatus) {
    if (value.status === 'ACCEPTED' && failOnce) {
      failOnce = false;
      throw Object.assign(new Error('simulated registry write interruption'), { code: 'SIMULATED_OFFER_UPDATE_FAILURE' });
    }
    return originalUpdate(value, expectedStatus);
  };
  assert.throws(() => f.dispatchService.respond({
    offer_id: offer.offer_id, response: 'ACCEPT', idempotency_key: 'first-accept'
  }, f.driver), error => error.code === 'SIMULATED_OFFER_UPDATE_FAILURE');
  assert.equal(f.db.deliveries.get(pending.delivery_id).status, 'ASSIGNED');
  assert.equal(f.db.offers.get(offer.offer_id).status, 'OFFERED');

  const recovered = f.dispatchService.respond({
    offer_id: offer.offer_id, response: 'ACCEPT', idempotency_key: 'retry-accept'
  }, f.driver);
  assert.equal(recovered.status, 'ASSIGNED');
  assert.equal(f.db.offers.get(offer.offer_id).status, 'ACCEPTED');
  assert.equal(f.db.deliveries.get(pending.delivery_id).version, 6);
});


test('delivery creation rejects invalid contact data before reserving an operation', () => {
  const f = fixture();
  assert.throws(() => f.service.create(Object.assign({}, f.input, { sender_phone: 'not-a-phone' }), f.actor, 'invalid-create'),
    error => error.code === 'DELIVERY_VALIDATION_FAILED');
  assert.equal(f.db.deliveries.size, 0);
  assert.equal(f.db.keys.size, 0);
});

test('only active same-company drivers are eligible for offers', () => {
  const f = fixture();
  const pending = prepareDispatch(f, 'driver-eligibility');
  assert.throws(() => f.dispatchService.createOffer({
    delivery_id: pending.delivery_id, driver_id: 'inactive-driver', idempotency_key: 'inactive-driver-offer'
  }, f.dispatcher), error => error.code === 'ACTIVE_COMPANY_DRIVER_REQUIRED');
  assert.equal(f.db.offers.size, 0);
  assert.equal(f.db.deliveries.get(pending.delivery_id).status, 'DISPATCH_PENDING');
});

test('valid cancellation is limited to RECEIVED and exceptional delivery can be reoffered', () => {
  const cancelFixture = fixture();
  const cancellable = cancelFixture.service.create(cancelFixture.input, cancelFixture.actor, 'cancel-received');
  const cancelled = cancelFixture.service.transition({
    delivery_id: cancellable.delivery_id, action: 'CANCEL', idempotency_key: 'cancel-before-dispatch'
  }, cancelFixture.actor);
  assert.equal(cancelled.status, 'CANCELLED');

  const f = fixture();
  const pending = prepareDispatch(f, 'failed-attempt');
  const offer = f.dispatchService.createOffer({
    delivery_id: pending.delivery_id, driver_id: 'driver', idempotency_key: 'offer-failed-attempt'
  }, f.dispatcher);
  f.dispatchService.respond({ offer_id: offer.offer_id, response: 'ACCEPT', idempotency_key: 'accept-failed-attempt' }, f.driver);
  f.service.transition({ delivery_id: pending.delivery_id, action: 'CONFIRM_COLLECTION', idempotency_key: 'collect-failed-attempt' }, f.driver);
  f.service.transition({ delivery_id: pending.delivery_id, action: 'START_TRANSIT', idempotency_key: 'transit-failed-attempt' }, f.driver);
  const failed = f.service.transition({
    delivery_id: pending.delivery_id, action: 'FAIL_DELIVERY',
    reason: 'Recipient unavailable', idempotency_key: 'fail-attempt'
  }, f.driver);
  assert.equal(failed.status, 'DELIVERY_ATTEMPTED');
  const returned = f.service.transition({
    delivery_id: pending.delivery_id, action: 'REOFFER', idempotency_key: 'reoffer-failed-attempt'
  }, f.dispatcher);
  assert.equal(returned.status, 'DISPATCH_PENDING');
  const nextOffer = f.dispatchService.createOffer({
    delivery_id: pending.delivery_id, driver_id: 'driver2', idempotency_key: 'new-driver-after-failure'
  }, f.dispatcher);
  assert.equal(nextOffer.status, 'OFFERED');
});


test('expiry transition is recovered if the offer status write is interrupted', () => {
  const f = fixture();
  const pending = prepareDispatch(f, 'expiry-interrupted');
  const offer = f.dispatchService.createOffer({
    delivery_id: pending.delivery_id, driver_id: 'driver', idempotency_key: 'offer-expiry-interrupted'
  }, f.dispatcher);
  f.setNow(offer.expires_at);
  const originalUpdate = f.store.updateOffer.bind(f.store);
  let failOnce = true;
  f.store.updateOffer = function (value, expectedStatus) {
    if (value.status === 'EXPIRED' && failOnce) {
      failOnce = false;
      throw Object.assign(new Error('simulated expiry status write interruption'), { code: 'SIMULATED_EXPIRY_WRITE_FAILURE' });
    }
    return originalUpdate(value, expectedStatus);
  };
  assert.throws(() => f.dispatchService.expireOffer(offer.offer_id, f.system),
    error => error.code === 'SIMULATED_EXPIRY_WRITE_FAILURE');
  assert.equal(f.db.deliveries.get(pending.delivery_id).status, 'DISPATCH_PENDING');
  assert.equal(f.db.offers.get(offer.offer_id).status, 'OFFERED');
  const recovered = f.dispatchService.expireOffer(offer.offer_id, f.system);
  assert.equal(recovered.status, 'DISPATCH_PENDING');
  assert.equal(f.db.offers.get(offer.offer_id).status, 'EXPIRED');
});

test('corrupt offer expiry fails closed', () => {
  const f = fixture();
  const pending = prepareDispatch(f, 'corrupt-expiry');
  const offer = f.dispatchService.createOffer({
    delivery_id: pending.delivery_id, driver_id: 'driver', idempotency_key: 'offer-corrupt-expiry'
  }, f.dispatcher);
  const persisted = f.db.offers.get(offer.offer_id);
  persisted.expires_at = 'not-a-timestamp';
  assert.throws(() => f.dispatchService.respond({
    offer_id: offer.offer_id, response: 'ACCEPT', idempotency_key: 'corrupt-expiry-accept'
  }, f.driver), error => error.code === 'DRIVER_OFFER_RECORD_INVALID');
});


function prepareProofFixture(f, options = {}) {
  const pending = prepareDispatch(f, options.key || 'pod');
  const offer = f.dispatchService.createOffer({
    delivery_id: pending.delivery_id, driver_id: 'driver', idempotency_key: 'offer-' + (options.key || 'pod')
  }, f.dispatcher);
  f.dispatchService.respond({ offer_id: offer.offer_id, response: 'ACCEPT', idempotency_key: 'accept-' + (options.key || 'pod') }, f.driver);
  f.service.transition({ delivery_id: pending.delivery_id, action: 'CONFIRM_COLLECTION', idempotency_key: 'collect-' + (options.key || 'pod') }, f.driver);
  f.service.transition({ delivery_id: pending.delivery_id, action: 'START_TRANSIT', idempotency_key: 'transit-' + (options.key || 'pod') }, f.driver);
  f.service.transition({ delivery_id: pending.delivery_id, action: 'ATTEMPT_DELIVERY', idempotency_key: 'attempt-' + (options.key || 'pod') }, f.driver);
  let id = 0;
  const sent = [];
  const proofService = c.createProofOfDeliveryService({
    store: f.store, actorResolver: f.actorResolver, deliveryService: options.deliveryService || f.service,
    clock: () => new Date(f.currentTime()), idFactory: () => 'POD-' + (options.key || 'default') + '-' + (++id),
    randomCode: () => '123456', digestOtp: value => 'TEST-MAC:' + value.split('').reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7).toString(16),
    otpSender: { send: (phone, code, context) => { sent.push({ phone, code, context }); } },
    drive: {
      getDeliveryEvidenceFolder: (companyId, deliveryId) => 'FOLDER:' + companyId + ':' + deliveryId,
      getFileMetadata: fileId => f.db.driveFiles.has(fileId) ? Object.assign({}, f.db.driveFiles.get(fileId)) : null,
      assertRestrictedAccess: fileId => {
        const file = f.db.driveFiles.get(fileId);
        if (!file || file.restricted !== true) throw Object.assign(new Error('access not restricted'), { code: 'DRIVE_ACCESS_NOT_RESTRICTED' });
      }
    },
    ttlMs: 300000, maxAttempts: 5
  });
  const challenge = proofService.issueChallenge({ delivery_id: pending.delivery_id }, f.driver);
  function addPhoto(fileId = 'FILE:' + pending.delivery_id) {
    f.db.driveFiles.set(fileId, {
      id: fileId, mime_type: 'image/jpeg', parent_ids: ['FOLDER:CO-A:' + pending.delivery_id],
      delivery_id: pending.delivery_id, company_id: 'CO-A', trashed: false, restricted: true
    });
    return proofService.registerEvidence({ challenge_id: challenge.challenge_id, drive_file_id: fileId, evidence_type: 'DELIVERY_PHOTO' }, f.driver);
  }
  return { pending, challenge, proofService, sent, addPhoto };
}

test('valid OTP plus same-delivery restricted photo completes once and never persists plaintext OTP', () => {
  const f = fixture();
  const p = prepareProofFixture(f, { key: 'valid-proof' });
  const evidence = p.addPhoto();
  const result = p.proofService.completeDelivery({
    challenge_id: p.challenge.challenge_id, otp: p.sent[0].code,
    evidence_ids: [evidence.evidence_id], idempotency_key: 'pod-complete-valid'
  }, f.driver);
  assert.equal(result.status, 'DELIVERED_VERIFIED');
  assert.equal(f.db.challenges.get(p.challenge.challenge_id).status, 'CONSUMED');
  assert.equal(JSON.stringify(f.db.challenges.get(p.challenge.challenge_id)).includes('123456'), false);
  assert.equal(f.db.events.filter(e => e.to_status === 'DELIVERED_VERIFIED').length, 1);
});

test('wrong OTP is rejected and increments attempts without completing delivery', () => {
  const f = fixture();
  const p = prepareProofFixture(f, { key: 'wrong-otp' });
  const evidence = p.addPhoto();
  assert.throws(() => p.proofService.completeDelivery({
    challenge_id: p.challenge.challenge_id, otp: '000000', evidence_ids: [evidence.evidence_id], idempotency_key: 'wrong-otp-1'
  }, f.driver), error => error.code === 'OTP_INVALID');
  assert.equal(f.db.challenges.get(p.challenge.challenge_id).attempt_count, 1);
  assert.equal(f.db.deliveries.get(p.pending.delivery_id).status, 'DELIVERY_VERIFICATION_PENDING');
});

test('expired OTP is invalidated and cannot complete delivery', () => {
  const f = fixture();
  const p = prepareProofFixture(f, { key: 'expired-otp' });
  const evidence = p.addPhoto();
  f.setNow(p.challenge.expires_at);
  assert.throws(() => p.proofService.completeDelivery({
    challenge_id: p.challenge.challenge_id, otp: p.sent[0].code, evidence_ids: [evidence.evidence_id], idempotency_key: 'expired-otp-1'
  }, f.driver), error => error.code === 'OTP_EXPIRED');
  assert.equal(f.db.challenges.get(p.challenge.challenge_id).status, 'INVALIDATED');
  assert.equal(f.db.deliveries.get(p.pending.delivery_id).status, 'DELIVERY_VERIFICATION_PENDING');
});

test('consumed OTP cannot be replayed with a different completion key', () => {
  const f = fixture();
  const p = prepareProofFixture(f, { key: 'replay-otp' });
  const evidence = p.addPhoto();
  const request = { challenge_id: p.challenge.challenge_id, otp: p.sent[0].code, evidence_ids: [evidence.evidence_id], idempotency_key: 'pod-replay-original' };
  p.proofService.completeDelivery(request, f.driver);
  assert.throws(() => p.proofService.completeDelivery(Object.assign({}, request, { idempotency_key: 'pod-replay-new-key' }), f.driver),
    error => error.code === 'PROOF_CHALLENGE_ALREADY_USED');
  assert.equal(f.db.events.filter(e => e.to_status === 'DELIVERED_VERIFIED').length, 1);
});

test('OTP attempt limit invalidates the challenge after five incorrect attempts', () => {
  const f = fixture();
  const p = prepareProofFixture(f, { key: 'otp-limit' });
  const evidence = p.addPhoto();
  for (let i = 0; i < 5; i++) {
    assert.throws(() => p.proofService.completeDelivery({
      challenge_id: p.challenge.challenge_id, otp: '000000', evidence_ids: [evidence.evidence_id], idempotency_key: 'otp-limit-' + i
    }, f.driver), error => error.code === 'OTP_INVALID');
  }
  assert.equal(f.db.challenges.get(p.challenge.challenge_id).status, 'INVALIDATED');
  assert.throws(() => p.proofService.completeDelivery({
    challenge_id: p.challenge.challenge_id, otp: p.sent[0].code, evidence_ids: [evidence.evidence_id], idempotency_key: 'otp-limit-final'
  }, f.driver), error => error.code === 'PROOF_CHALLENGE_INVALID');
});

test('unauthorized and unassigned driver cannot issue a challenge or submit proof', () => {
  const f = fixture();
  const p = prepareProofFixture(f, { key: 'wrong-driver' });
  assert.throws(() => p.proofService.issueChallenge({ delivery_id: p.pending.delivery_id }, f.driver2),
    error => error.code === 'ASSIGNED_DRIVER_REQUIRED');
  const evidence = p.addPhoto();
  assert.throws(() => p.proofService.completeDelivery({
    challenge_id: p.challenge.challenge_id, otp: p.sent[0].code, evidence_ids: [evidence.evidence_id], idempotency_key: 'wrong-driver-complete'
  }, f.driver2), error => error.code === 'ASSIGNED_DRIVER_REQUIRED');
  assert.equal(f.db.deliveries.get(p.pending.delivery_id).status, 'DELIVERY_VERIFICATION_PENDING');
});

test('evidence from another delivery cannot be replayed against a different challenge', () => {
  const f = fixture();
  const a = prepareProofFixture(f, { key: 'cross-a' });
  const evidenceA = a.addPhoto('FILE-CROSS-A');
  const b = prepareProofFixture(f, { key: 'cross-b' });
  assert.throws(() => b.proofService.completeDelivery({
    challenge_id: b.challenge.challenge_id, otp: b.sent[0].code, evidence_ids: [evidenceA.evidence_id], idempotency_key: 'cross-delivery-replay'
  }, f.driver), error => error.code === 'PROOF_EVIDENCE_BINDING_INVALID');
  assert.equal(f.db.deliveries.get(b.pending.delivery_id).status, 'DELIVERY_VERIFICATION_PENDING');
});

test('forged or publicly shared Drive references are rejected before evidence registration', () => {
  const f = fixture();
  const p = prepareProofFixture(f, { key: 'forged-drive' });
  assert.throws(() => p.proofService.registerEvidence({
    challenge_id: p.challenge.challenge_id, drive_file_id: 'FORGED-ID', evidence_type: 'DELIVERY_PHOTO'
  }, f.driver), error => error.code === 'DRIVE_EVIDENCE_REFERENCE_INVALID');
  f.db.driveFiles.set('PUBLIC-FILE', {
    id: 'PUBLIC-FILE', mime_type: 'image/jpeg', parent_ids: ['FOLDER:CO-A:' + p.pending.delivery_id],
    delivery_id: p.pending.delivery_id, company_id: 'CO-A', trashed: false, restricted: false
  });
  assert.throws(() => p.proofService.registerEvidence({
    challenge_id: p.challenge.challenge_id, drive_file_id: 'PUBLIC-FILE', evidence_type: 'DELIVERY_PHOTO'
  }, f.driver), error => error.code === 'DRIVE_ACCESS_VALIDATION_FAILED');
  assert.equal(f.db.proofEvidence.size, 0);
});

test('missing evidence and failed Drive upload cannot complete delivery', () => {
  const f = fixture();
  const p = prepareProofFixture(f, { key: 'missing-evidence' });
  assert.throws(() => p.proofService.completeDelivery({
    challenge_id: p.challenge.challenge_id, otp: p.sent[0].code, evidence_ids: [], idempotency_key: 'missing-evidence'
  }, f.driver), error => error.code === 'PROOF_EVIDENCE_REQUIRED');
  assert.throws(() => p.proofService.registerEvidence({
    challenge_id: p.challenge.challenge_id, drive_file_id: 'UPLOAD-FAILED-NO-FILE', evidence_type: 'DELIVERY_PHOTO'
  }, f.driver), error => error.code === 'DRIVE_EVIDENCE_REFERENCE_INVALID');
  assert.equal(f.db.deliveries.get(p.pending.delivery_id).status, 'DELIVERY_VERIFICATION_PENDING');
});

test('duplicate completion request is idempotent and creates one completion event', () => {
  const f = fixture();
  const p = prepareProofFixture(f, { key: 'duplicate-completion' });
  const evidence = p.addPhoto();
  const request = { challenge_id: p.challenge.challenge_id, otp: p.sent[0].code, evidence_ids: [evidence.evidence_id], idempotency_key: 'duplicate-completion-key' };
  const first = p.proofService.completeDelivery(request, f.driver);
  const second = p.proofService.completeDelivery(request, f.driver);
  assert.equal(first.status, 'DELIVERED_VERIFIED');
  assert.equal(second.status, 'DELIVERED_VERIFIED');
  assert.equal(f.db.events.filter(e => e.to_status === 'DELIVERED_VERIFIED').length, 1);
});

test('interrupted proof completion recovers using the same challenge, evidence and idempotency key', () => {
  const f = fixture();
  let failOnce = true;
  const interruptedDeliveryService = {
    get: f.service.get,
    transition(args, actor) {
      if (args.action === 'VERIFY_OTP' && failOnce) {
        failOnce = false;
        throw Object.assign(new Error('simulated completion interruption'), { code: 'SIMULATED_COMPLETION_INTERRUPTION' });
      }
      return f.service.transition(args, actor);
    }
  };
  const p = prepareProofFixture(f, { key: 'recovery-proof', deliveryService: interruptedDeliveryService });
  const evidence = p.addPhoto();
  const request = { challenge_id: p.challenge.challenge_id, otp: p.sent[0].code, evidence_ids: [evidence.evidence_id], idempotency_key: 'recovery-proof-key' };
  assert.throws(() => p.proofService.completeDelivery(request, f.driver), error => error.code === 'SIMULATED_COMPLETION_INTERRUPTION');
  assert.equal(f.db.challenges.get(p.challenge.challenge_id).status, 'COMPLETING');
  const recovered = p.proofService.completeDelivery(request, f.driver);
  assert.equal(recovered.status, 'DELIVERED_VERIFIED');
  assert.equal(f.db.challenges.get(p.challenge.challenge_id).status, 'CONSUMED');
});


test('interruption after challenge reservation but before proof-row write is recoverable', () => {
  const f = fixture();
  const p = prepareProofFixture(f, { key: 'proof-row-recovery' });
  const evidence = p.addPhoto();
  const originalCreate = f.store.createProofRecord.bind(f.store);
  let failOnce = true;
  f.store.createProofRecord = function (proof) {
    if (failOnce) {
      failOnce = false;
      throw Object.assign(new Error('simulated proof-row write interruption'), { code: 'SIMULATED_PROOF_ROW_FAILURE' });
    }
    return originalCreate(proof);
  };
  const request = { challenge_id: p.challenge.challenge_id, otp: p.sent[0].code, evidence_ids: [evidence.evidence_id], idempotency_key: 'proof-row-recovery-key' };
  assert.throws(() => p.proofService.completeDelivery(request, f.driver), error => error.code === 'SIMULATED_PROOF_ROW_FAILURE');
  assert.equal(f.db.challenges.get(p.challenge.challenge_id).status, 'COMPLETING');
  assert.equal(f.db.proofRecords.size, 0);
  const recovered = p.proofService.completeDelivery(request, f.driver);
  assert.equal(recovered.status, 'DELIVERED_VERIFIED');
  assert.equal(f.db.proofRecords.size, 1);
  assert.equal(f.db.challenges.get(p.challenge.challenge_id).status, 'CONSUMED');
});
