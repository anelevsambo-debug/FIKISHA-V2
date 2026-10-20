const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture() {
  const context = vm.createContext({});
  for (const file of ['errors.js', 'ids.js', 'validators.js', 'permissions.js', 'stateMachine.js', 'actorResolver.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/core', file), 'utf8'), context);
  }
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/deliveries/service.js'), 'utf8'), context);

  const db = { deliveries: new Map(), events: [], idempotency: new Map() };
  let failNextEvent = true;
  const store = {
    getDelivery: id => db.deliveries.get(id) || null,
    reserveIdempotency(key, candidate) {
      if (db.idempotency.has(key)) return { created: false, record: db.idempotency.get(key) };
      db.idempotency.set(key, candidate);
      return { created: true, record: candidate };
    },
    completeIdempotency(key, record) {
      if (!db.idempotency.has(key)) throw Object.assign(new Error('reservation missing'), { code: 'IDEMPOTENCY_RESERVATION_MISSING' });
      db.idempotency.set(key, record);
    },
    ensureDelivery(delivery) {
      const existing = db.deliveries.get(delivery.delivery_id);
      if (existing) return { created: false, delivery: existing };
      db.deliveries.set(delivery.delivery_id, delivery);
      return { created: true, delivery };
    },
    ensureEvent(event) {
      if (failNextEvent) {
        failNextEvent = false;
        throw Object.assign(new Error('simulated event write failure'), { code: 'SIMULATED_EVENT_WRITE_FAILURE' });
      }
      const existing = db.events.find(item => item.event_id === event.event_id);
      if (existing) return { created: false, event: existing };
      db.events.push(event);
      return { created: true, event };
    },
    saveDelivery() { throw new Error('not used by create-recovery test'); },
    appendEvent() { throw new Error('not used by create-recovery test'); },
    isProofVerified() { return false; },
    isActiveDriver() { return false; }
  };

  const identities = new WeakMap();
  const actorResolver = context.createTrustedActorResolver({
    getAuthenticatedEmail: invocation => identities.get(invocation) || '',
    membershipStore: {
      getMembershipByEmail(email) {
        return email === 'admin@example.test'
          ? { actor_id: 'admin-a', email: 'admin@example.test', company_id: 'COMPANY-A', role: 'COMPANY_ADMIN', active: true }
          : null;
      }
    }
  });
  const invocation = {};
  identities.set(invocation, 'admin@example.test');
  const actor = actorResolver.resolve(invocation, 'COMPANY-A');

  let id = 0;
  const service = context.createDeliveryService({
    store,
    actorResolver,
    clock: () => new Date('2026-10-20T00:00:00.000Z'),
    idFactory: () => 'TEST-' + (++id)
  });
  return {
    db,
    service,
    actor,
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

test('retry resumes a reserved create after event write fails without duplicating the delivery', () => {
  const f = fixture();
  assert.throws(
    () => f.service.create(f.input, f.actor, 'retry-key-1'),
    error => error.code === 'SIMULATED_EVENT_WRITE_FAILURE'
  );

  assert.equal(f.db.deliveries.size, 1);
  assert.equal(f.db.events.length, 0);
  assert.equal(f.db.idempotency.get('COMPANY-A:retry-key-1').state, 'IN_PROGRESS');

  const recovered = f.service.create(f.input, f.actor, 'retry-key-1');

  assert.equal(f.db.deliveries.size, 1);
  assert.equal(f.db.events.length, 1);
  assert.equal(recovered.delivery_id, Array.from(f.db.deliveries.keys())[0]);
  assert.equal(f.db.idempotency.get('COMPANY-A:retry-key-1').state, 'COMPLETED');
});
