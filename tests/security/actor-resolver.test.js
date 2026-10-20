const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture(options = {}) {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/core/errors.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/core/actorResolver.js'), 'utf8'), context);

  const identities = new WeakMap();
  const systemPrincipals = new WeakMap();
  const memberships = new Map([
    ['admin@example.test', { actor_id: 'admin-a', email: 'ADMIN@example.test', company_id: 'CO-A', role: 'COMPANY_ADMIN', active: true }],
    ['driver@example.test', { actor_id: 'driver-a', email: 'driver@example.test', company_id: 'CO-A', role: 'DRIVER', active: true }],
    ['inactive@example.test', { actor_id: 'inactive-a', email: 'inactive@example.test', company_id: 'CO-A', role: 'DISPATCHER', active: false }],
    ['developer@example.test', { actor_id: 'developer-a', email: 'developer@example.test', company_id: 'CO-A', role: 'DEVELOPER', active: true }]
  ]);
  const resolver = context.createTrustedActorResolver({
    getAuthenticatedEmail(invocation) {
      if (options.identityFailure) throw new Error('sensitive identity provider details');
      return identities.get(invocation) || '';
    },
    getAuthenticatedSystemPrincipal(invocation) {
      if (options.systemFailure) throw new Error('sensitive system identity details');
      return systemPrincipals.get(invocation) || '';
    },
    membershipStore: {
      getMembershipByEmail(email) {
        if (options.registryFailure) throw new Error('sensitive registry details');
        return memberships.get(email) || null;
      },
      getPlatformAdminByEmail(email) {
        if (options.registryFailure) throw new Error('sensitive registry details');
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
  function systemInvocation(principal) {
    const value = {};
    systemPrincipals.set(value, principal);
    return value;
  }
  return { resolver, invocation, systemInvocation };
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


test('request-supplied email, actor, role and company cannot override trusted invocation identity', () => {
  const f = fixture();
  const request = Object.assign(f.invocation('admin@example.test'), {
    email: 'attacker@example.test',
    actor_id: 'platform-admin-1',
    role: 'PLATFORM_ADMIN',
    company_id: 'CO-B',
    platform_admin: true
  });

  const actor = f.resolver.resolve(request, 'CO-A');
  assert.equal(actor.email, 'admin@example.test');
  assert.equal(actor.actor_id, 'admin-a');
  assert.equal(actor.role, 'COMPANY_ADMIN');
  assert.equal(actor.company_id, 'CO-A');
  assert.equal(actor.platform_admin, undefined);
});

test('forged company context cannot grant access to another company', () => {
  const f = fixture();
  const request = Object.assign(f.invocation('admin@example.test'), {
    email: 'admin@example.test',
    company_id: 'CO-B',
    role: 'COMPANY_ADMIN'
  });

  assert.throws(
    () => f.resolver.resolve(request, 'CO-B'),
    error => error.code === 'TENANT_ACCESS_DENIED'
  );
});

test('unknown authenticated actor has no membership and is denied', () => {
  const f = fixture();
  assert.throws(
    () => f.resolver.resolve(f.invocation('unknown@example.test'), 'CO-A'),
    error => error.code === 'MEMBERSHIP_NOT_FOUND'
  );
});

test('identity-provider failure is converted to a fail-closed error without provider details', () => {
  const f = fixture({ identityFailure: true });
  assert.throws(
    () => f.resolver.resolve({}, 'CO-A'),
    error => error.code === 'IDENTITY_PROVIDER_FAILURE' &&
      !String(error.message).includes('sensitive')
  );
});

test('membership registry failure is converted to a fail-closed error without registry details', () => {
  const f = fixture({ registryFailure: true });
  assert.throws(
    () => f.resolver.resolve(f.invocation('admin@example.test'), 'CO-A'),
    error => error.code === 'IDENTITY_REGISTRY_UNAVAILABLE' &&
      !String(error.message).includes('sensitive')
  );
});

test('platform admin identity is not implicitly a company member', () => {
  const f = fixture();
  assert.throws(
    () => f.resolver.resolve(f.invocation('platform-admin@example.test'), 'CO-A'),
    error => error.code === 'MEMBERSHIP_NOT_FOUND'
  );
});

test('inactive platform administrator is denied', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/core/errors.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/core/actorResolver.js'), 'utf8'), context);
  const invocation = {};
  const resolver = context.createTrustedActorResolver({
    getAuthenticatedEmail: () => 'inactive-admin@example.test',
    membershipStore: {
      getMembershipByEmail: () => null,
      getPlatformAdminByEmail: () => ({
        actor_id: 'inactive-platform-admin',
        email: 'inactive-admin@example.test',
        active: false
      })
    }
  });
  assert.throws(
    () => resolver.resolvePlatformAdmin(invocation),
    error => error.code === 'ACTOR_INACTIVE'
  );
});


test('system actor requires a separately injected authenticated system principal', () => {
  const f = fixture();
  assert.throws(
    () => f.resolver.resolveSystemActor({}, 'CO-A'),
    error => error.code === 'SYSTEM_IDENTITY_REQUIRED'
  );
  const actor = f.resolver.resolveSystemActor(f.systemInvocation('expiry-worker'), 'CO-A');
  assert.equal(actor.actor_id, 'SYSTEM:expiry-worker');
  assert.equal(actor.role, 'SYSTEM');
  assert.equal(actor.company_id, 'CO-A');
  assert.equal(f.resolver.isTrusted(actor), true);
});

test('system principal failures are normalized and do not leak provider details', () => {
  const f = fixture({ systemFailure: true });
  assert.throws(
    () => f.resolver.resolveSystemActor({}, 'CO-A'),
    error => error.code === 'SYSTEM_IDENTITY_PROVIDER_FAILURE' && !error.message.includes('sensitive')
  );
});
