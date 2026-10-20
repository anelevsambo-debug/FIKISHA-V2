const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/core/errors.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/core/actorResolver.js'), 'utf8'), context);

  const identities = new WeakMap();
  const memberships = new Map([
    ['admin@example.test', { actor_id: 'admin-a', email: 'ADMIN@example.test', company_id: 'CO-A', role: 'COMPANY_ADMIN', active: true }],
    ['driver@example.test', { actor_id: 'driver-a', email: 'driver@example.test', company_id: 'CO-A', role: 'DRIVER', active: true }],
    ['inactive@example.test', { actor_id: 'inactive-a', email: 'inactive@example.test', company_id: 'CO-A', role: 'DISPATCHER', active: false }],
    ['developer@example.test', { actor_id: 'developer-a', email: 'developer@example.test', company_id: 'CO-A', role: 'DEVELOPER', active: true }]
  ]);
  const resolver = context.createTrustedActorResolver({
    getAuthenticatedEmail: invocation => identities.get(invocation) || '',
    membershipStore: {
      getMembershipByEmail(email) { return memberships.get(email) || null; },
      getPlatformAdminByEmail(email) {
        return email === 'platform-admin@example.test'
          ? { actor_id: 'platform-admin-1', email: 'platform-admin@example.test', active: true }
          : null;
      }
    }
  });
  function invocation(email) {
    const value = {};
    identities.set(value, email);
    return value;
  }
  return { resolver, invocation };
}

test('resolver creates a frozen actor from authenticated identity and active membership', () => {
  const f = fixture();
  const actor = f.resolver.resolve(f.invocation('ADMIN@example.test'), 'CO-A');

  assert.equal(actor.actor_id, 'admin-a');
  assert.equal(actor.email, 'admin@example.test');
  assert.equal(actor.company_id, 'CO-A');
  assert.equal(actor.role, 'COMPANY_ADMIN');
  assert.equal(actor.active, true);
  assert.equal(Object.isFrozen(actor), true);
  assert.equal(f.resolver.isTrusted(actor), true);
  assert.equal(f.resolver.assertTrusted(actor), actor);
});

test('missing authenticated identity fails closed', () => {
  const f = fixture();
  assert.throws(
    () => f.resolver.resolve({}, 'CO-A'),
    error => error.code === 'AUTHENTICATED_IDENTITY_REQUIRED'
  );
});

test('membership for another company cannot authorize the requested company', () => {
  const f = fixture();
  assert.throws(
    () => f.resolver.resolve(f.invocation('admin@example.test'), 'CO-B'),
    error => error.code === 'TENANT_ACCESS_DENIED'
  );
});

test('inactive membership fails closed', () => {
  const f = fixture();
  assert.throws(
    () => f.resolver.resolve(f.invocation('inactive@example.test'), 'CO-A'),
    error => error.code === 'ACTOR_INACTIVE'
  );
});

test('developer role cannot be used as a company delivery actor', () => {
  const f = fixture();
  assert.throws(
    () => f.resolver.resolve(f.invocation('developer@example.test'), 'CO-A'),
    error => error.code === 'ACTOR_ROLE_INVALID'
  );
});


test('platform admin resolution uses a separate trusted registry lookup', () => {
  const f = fixture();
  const actor = f.resolver.resolvePlatformAdmin(f.invocation('platform-admin@example.test'));
  assert.equal(actor.actor_id, 'platform-admin-1');
  assert.equal(actor.role, 'DEVELOPER');
  assert.equal(actor.platform_admin, true);
  assert.equal(actor.active, true);
  assert.equal(f.resolver.isTrusted(actor), true);
});

test('caller-created actor objects are not trusted', () => {
  const f = fixture();
  assert.throws(
    () => f.resolver.assertTrusted({ actor_id: 'admin-a', company_id: 'CO-A', role: 'COMPANY_ADMIN', active: true }),
    error => error.code === 'UNTRUSTED_ACTOR_CONTEXT'
  );
});
