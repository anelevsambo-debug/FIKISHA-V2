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
  let failNextEvent = false;
  let exclusiveCalls = 0;
  const store = {
    runExclusive(work) { exclusiveCalls += 1; return work(); },
    getDelivery: id => db.deliveries.get(id) || null,
    getIdempotency: key => db.idempotency.get(key) || null,
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
    saveDelivery(delivery, expectedVersion) {
      const existing = db.deliveries.get(delivery.delivery_id);
      if (!existing || Number(existing.version) !== Number(expectedVersion)) throw Object.assign(new Error('conflict'), { code: 'CONCURRENT_UPDATE' });
      db.deliveries.set(delivery.delivery_id, delivery);
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
    failNextEventOnce() { failNextEvent = true; },
    exclusiveCalls: () => exclusiveCalls,
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


test('retry completes a transition after the delivery write succeeds but the event write fails', () => {
  const f = fixture();
  const delivery = f.service.create(f.input, f.actor, 'transition-recovery-create');
  f.db.deliveries.set(delivery.delivery_id, Object.assign({}, delivery, { status: 'READY_FOR_QUOTE', version: 1 }));
  f.failNextEventOnce();
  const request = { delivery_id: delivery.delivery_id, action: 'ISSUE_QUOTE', idempotency_key: 'transition-recovery-1' };

  assert.throws(
    () => f.service.transition(request, f.actor),
    error => error.code === 'SIMULATED_EVENT_WRITE_FAILURE'
  );
  assert.equal(f.db.deliveries.get(delivery.delivery_id).status, 'QUOTE_ISSUED');
  assert.equal(f.db.deliveries.get(delivery.delivery_id).version, 2);
  assert.equal(f.db.events.length, 1);
  assert.equal(f.db.idempotency.get('COMPANY-A:TRANSITION:transition-recovery-1').state, 'IN_PROGRESS');

  const recovered = f.service.transition(request, f.actor);

  assert.equal(recovered.status, 'QUOTE_ISSUED');
  assert.equal(f.db.deliveries.get(delivery.delivery_id).version, 2);
  assert.equal(f.db.events.length, 2);
  assert.equal(f.db.idempotency.get('COMPANY-A:TRANSITION:transition-recovery-1').state, 'COMPLETED');
});

test('retry resumes a reserved create after event write fails without duplicating the delivery', () => {
  const f = fixture();
  f.failNextEventOnce();
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


test('same idempotency key from concurrent callers resolves to one delivery and one creation event', async () => {
  const f = fixture();
  const results = await Promise.all([
    Promise.resolve().then(() => f.service.create(f.input, f.actor, 'same-key-race')),
    Promise.resolve().then(() => f.service.create(f.input, f.actor, 'same-key-race'))
  ]);

  assert.equal(results[0].delivery_id, results[1].delivery_id);
  assert.equal(f.db.deliveries.size, 1);
  assert.equal(f.db.events.length, 1);
  assert.equal(f.db.idempotency.get('COMPANY-A:same-key-race').state, 'COMPLETED');
});

test('conflicting lifecycle updates cannot both apply to the same version', async () => {
  const f = fixture();
  const created = f.service.create(f.input, f.actor, 'conflict-seed');
  f.db.deliveries.set(created.delivery_id, Object.assign({}, created, {
    status: 'READY_FOR_QUOTE',
    version: 1
  }));
  const baseEventCount = f.db.events.length;
  const requests = [
    { delivery_id: created.delivery_id, action: 'ISSUE_QUOTE', idempotency_key: 'conflict-a' },
    { delivery_id: created.delivery_id, action: 'ISSUE_QUOTE', idempotency_key: 'conflict-b' }
  ];
  const results = await Promise.allSettled(requests.map(request =>
    Promise.resolve().then(() => f.service.transition(request, f.actor))
  ));

  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(f.db.deliveries.get(created.delivery_id).status, 'QUOTE_ISSUED');
  assert.equal(f.db.deliveries.get(created.delivery_id).version, 2);
  assert.equal(f.db.events.length, baseEventCount + 1);
});

test('completed create followed by a lost response and retry does not duplicate effects', () => {
  const f = fixture();
  let firstDeliveryId;
  try {
    firstDeliveryId = f.service.create(f.input, f.actor, 'lost-response-create').delivery_id;
    throw Object.assign(new Error('simulated client timeout after server commit'), { code: 'CLIENT_TIMEOUT' });
  } catch (error) {
    assert.equal(error.code, 'CLIENT_TIMEOUT');
  }

  const retried = f.service.create(f.input, f.actor, 'lost-response-create');
  assert.equal(retried.delivery_id, firstDeliveryId);
  assert.equal(f.db.deliveries.size, 1);
  assert.equal(f.db.events.length, 1);
});

test('retrying a completed transition returns its stored result without another event', () => {
  const f = fixture();
  const created = f.service.create(f.input, f.actor, 'completed-transition-seed');
  f.db.deliveries.set(created.delivery_id, Object.assign({}, created, {
    status: 'READY_FOR_QUOTE',
    version: 1
  }));
  const request = { delivery_id: created.delivery_id, action: 'ISSUE_QUOTE', idempotency_key: 'completed-transition' };

  const first = f.service.transition(request, f.actor);
  const eventsAfterFirst = f.db.events.length;
  const second = f.service.transition(request, f.actor);

  assert.equal(second.status, first.status);
  assert.equal(second.version, first.version);
  assert.equal(f.db.events.length, eventsAfterFirst);
  assert.equal(f.db.deliveries.get(created.delivery_id).version, 2);
});


test('same create idempotency key with a different payload is rejected', () => {
  const f = fixture();
  f.service.create(f.input, f.actor, 'payload-bound-key');
  const changed = Object.assign({}, f.input, { dropoff_text: 'Different destination' });

  assert.throws(
    () => f.service.create(changed, f.actor, 'payload-bound-key'),
    error => error.code === 'IDEMPOTENCY_KEY_REUSED'
  );
  assert.equal(f.db.deliveries.size, 1);
  assert.equal(f.db.events.length, 1);
});


test('delivery create and transition delegate the whole operation to the exclusive store boundary', () => {
  const f = fixture();
  const delivery = f.service.create(f.input, f.actor, 'exclusive-create');
  assert.equal(f.exclusiveCalls(), 1);

  f.db.deliveries.set(delivery.delivery_id, Object.assign({}, delivery, {
    status: 'READY_FOR_QUOTE',
    version: 1
  }));
  f.service.transition({
    delivery_id: delivery.delivery_id,
    action: 'ISSUE_QUOTE',
    idempotency_key: 'exclusive-transition'
  }, f.actor);
  assert.equal(f.exclusiveCalls(), 2);
});
