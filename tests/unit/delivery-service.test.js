const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const c = vm.createContext({});
for (const file of ['errors.js', 'ids.js', 'validators.js', 'permissions.js', 'stateMachine.js', 'tenants.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/core', file), 'utf8'), c);
}
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/deliveries/service.js'), 'utf8'), c);

function fixture() {
  const db = {
    deliveries: new Map(),
    events: [],
    keys: new Map(),
    proofs: new Set(),
    drivers: new Set()
  };
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
  let n = 0;
  return {
    db,
    store,
    service: c.createDeliveryService({
      store,
      clock: () => new Date('2026-10-20T00:00:00Z'),
      idFactory: () => 'ID-' + (++n)
    }),
    actor: { actor_id: 'admin-1', company_id: 'CO-A', role: 'COMPANY_ADMIN', active: true },
    input: {
      sender_name: 'Sender',
      sender_phone: '+26770000001',
      recipient_name: 'Recipient',
      recipient_phone: '+26770000002',
      pickup_text: 'Pickup',
      dropoff_text: 'Dropoff',
      consent_status: 'OPTED_IN'
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
    () => f.service.get(delivery.delivery_id, { actor_id: 'other', company_id: 'CO-B', role: 'COMPANY_ADMIN', active: true }),
    error => error.code === 'TENANT_ACCESS_DENIED'
  );
});

test('driver cannot complete delivery without verified proof', () => {
  const f = fixture();
  const delivery = f.service.create(f.input, f.actor, 'req-1');
  const driver = { actor_id: 'driver', company_id: 'CO-A', role: 'DRIVER', active: true };
  f.db.deliveries.set(delivery.delivery_id, Object.assign({}, delivery, { status: 'DELIVERY_VERIFICATION_PENDING' }));
  assert.throws(
    () => f.service.transition({ delivery_id: delivery.delivery_id, action: 'VERIFY_OTP', proof_id: 'proof-x' }, driver),
    error => error.code === 'VERIFIED_PROOF_REQUIRED'
  );
});

test('inactive actor cannot create a delivery', () => {
  const f = fixture();
  assert.throws(
    () => f.service.create(f.input, Object.assign({}, f.actor, { active: false }), 'req-1'),
    error => error.code === 'DELIVERY_CREATE_FORBIDDEN'
  );
});
