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

function fixture() {
  const db = { deliveries: new Map(), events: [], keys: new Map(), proofs: new Set(), drivers: new Set(), offers: new Map(), outbox: new Map() };
  let nowMs = Date.parse('2026-10-20T00:00:00Z');
  const store = {
    runExclusive: work => work(),
    getOffer: id => db.offers.get(id) || null,
    getOfferByRequestKey: (company, key) => Array.from(db.offers.values()).find(o => o.company_id === company && o.request_key === key) || null,
    listOffersForDelivery: id => Array.from(db.offers.values()).filter(o => o.delivery_id === id),
    createOffer(offer) {
      const prior = db.offers.get(offer.offer_id) || this.getOfferByRequestKey(offer.company_id, offer.request_key);
      if (prior) {
        if (prior.company_id !== offer.company_id || prior.delivery_id !== offer.delivery_id || prior.driver_id !== offer.driver_id || prior.request_key !== offer.request_key) {
          throw Object.assign(new Error('offer conflict'), { code: 'DRIVER_OFFER_ID_CONFLICT' });
        }
        return { created: false, offer: prior };
      }
      db.offers.set(offer.offer_id, Object.assign({}, offer));
      return { created: true, offer: db.offers.get(offer.offer_id) };
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
    getNotification: id => db.outbox.get(id) || null,
    listDueNotifications(now, limit) {
      return Array.from(db.outbox.values()).filter(n =>
        (n.status === 'PENDING' || n.status === 'RETRY') &&
        (!n.next_attempt_at || n.next_attempt_at <= now) ||
        (n.status === 'PROCESSING' && n.lease_until && n.lease_until <= now)
      ).slice(0, limit);
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
    isProofVerified: (proof, delivery, company) => db.proofs.has([proof, delivery, company].join(':')),
    isActiveDriver: (id, company) => db.drivers.has([id, company].join(':'))
  };

  const identities = new WeakMap();
  const memberships = new Map([
    ['admin-a@example.test', { actor_id: 'admin-1', email: 'admin-a@example.test', company_id: 'CO-A', role: 'COMPANY_ADMIN', active: true }],
    ['other@example.test', { actor_id: 'other', email: 'other@example.test', company_id: 'CO-B', role: 'COMPANY_ADMIN', active: true }],
    ['driver@example.test', { actor_id: 'driver', email: 'driver@example.test', company_id: 'CO-A', role: 'DRIVER', active: true }],
    ['driver2@example.test', { actor_id: 'driver2', email: 'driver2@example.test', company_id: 'CO-A', role: 'DRIVER', active: true }],
    ['dispatcher@example.test', { actor_id: 'dispatcher', email: 'dispatcher@example.test', company_id: 'CO-A', role: 'DISPATCHER', active: true }],
    ['system@example.test', { actor_id: 'system', email: 'system@example.test', company_id: 'CO-A', role: 'SYSTEM', active: true }]
  ]);
  const actorResolver = c.createTrustedActorResolver({
    getAuthenticatedEmail: invocation => identities.get(invocation) || '',
    membershipStore: { getMembershipByEmail: email => memberships.get(email) || null }
  });
  function invocation(email) {
    const value = {};
    identities.set(value, email);
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
    actorResolver,
    service,
    dispatchService,
    outboxService,
    actor: actorResolver.resolve(invocation('admin-a@example.test'), 'CO-A'),
    otherActor: actorResolver.resolve(invocation('other@example.test'), 'CO-B'),
    driver: actorResolver.resolve(invocation('driver@example.test'), 'CO-A'),
    driver2: actorResolver.resolve(invocation('driver2@example.test'), 'CO-A'),
    dispatcher: actorResolver.resolve(invocation('dispatcher@example.test'), 'CO-A'),
    system: actorResolver.resolve(invocation('system@example.test'), 'CO-A'),
    dispatchService: null,
    outboxService: null,
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
  f.db.deliveries.set(delivery.delivery_id, Object.assign({}, delivery, { status: 'DELIVERY_VERIFICATION_PENDING' }));
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
    status: 'DELIVERY_VERIFICATION_PENDING'
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
  f.service.transition = function (args, actor) {
    if (args.action === 'OFFER_TO_DRIVER' && failOnce) {
      failOnce = false;
      throw Object.assign(new Error('simulated interruption'), { code: 'SIMULATED_TRANSITION_INTERRUPTION' });
    }
    return originalTransition(args, actor);
  };
  const request = { delivery_id: pending.delivery_id, driver_id: 'driver', idempotency_key: 'offer-partial' };
  assert.throws(() => f.dispatchService.createOffer(request, f.dispatcher),
    error => error.code === 'SIMULATED_TRANSITION_INTERRUPTION');
  assert.equal(f.db.offers.size, 1);
  assert.equal(f.db.deliveries.get(pending.delivery_id).status, 'DISPATCH_PENDING');

  const recovered = f.dispatchService.createOffer(request, f.dispatcher);
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
