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

function fixture() {
  const db = { deliveries: new Map(), events: [], keys: new Map(), proofs: new Set(), drivers: new Set() };
  const store = {
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
    ['driver@example.test', { actor_id: 'driver', email: 'driver@example.test', company_id: 'CO-A', role: 'DRIVER', active: true }]
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

  let n = 0;
  return {
    db,
    actorResolver,
    service: c.createDeliveryService({
      store,
      actorResolver,
      clock: () => new Date('2026-10-20T00:00:00Z'),
      idFactory: () => 'ID-' + (++n)
    }),
    actor: actorResolver.resolve(invocation('admin-a@example.test'), 'CO-A'),
    otherActor: actorResolver.resolve(invocation('other@example.test'), 'CO-B'),
    driver: actorResolver.resolve(invocation('driver@example.test'), 'CO-A'),
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
