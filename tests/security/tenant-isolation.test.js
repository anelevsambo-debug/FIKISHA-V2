const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture(options = {}) {
  const context = vm.createContext({});
  for (const file of ['errors.js', 'actorResolver.js', 'tenants.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/core', file), 'utf8'), context);
  }
  const companies = new Map([
    ['CO-A', { company_id: 'CO-A', status: 'ACTIVE', drive_folder_id: 'folder-A', workbook_id: 'workbook-A' }],
    ['CO-B', { company_id: 'CO-B', status: 'ACTIVE', drive_folder_id: 'folder-B', workbook_id: 'workbook-B' }]
  ]);
  if (options.company) companies.set(options.company.company_id, options.company);
  const folders = new Map();
  const files = new Map();
  const workbooks = new Map();

  for (const id of ['CO-A', 'CO-B']) {
    const folderId = 'folder-' + id.slice(-1);
    const workbookId = 'workbook-' + id.slice(-1);
    folders.set(folderId, {
      getId: () => folderId,
      getDescription: () => options.folderDescription && id === 'CO-A'
        ? options.folderDescription
        : 'FIKISHA-V2|company_id=' + id + '|resource=operations-folder'
    });
    files.set(workbookId, {
      getId: () => workbookId,
      getDescription: () => options.fileDescription && id === 'CO-A'
        ? options.fileDescription
        : 'FIKISHA-V2|company_id=' + id + '|resource=operations-workbook'
    });
    const configRows = [
      ['key', 'value'],
      ['company_id', options.configCompanyId && id === 'CO-A' ? options.configCompanyId : id],
      ['schema_version', options.schemaVersion && id === 'CO-A' ? options.schemaVersion : '2']
    ];
    const config = {
      getLastRow: () => configRows.length,
      getRange: () => ({ getValues: () => configRows })
    };
    workbooks.set(workbookId, {
      getId: () => workbookId,
      getSheetByName: name => name === 'CompanyConfig' ? config : null
    });
  }

  const identities = new WeakMap();
  const resolver = context.createTrustedActorResolver({
    getAuthenticatedEmail: invocation => identities.get(invocation) || '',
    membershipStore: {
      getMembershipByEmail(email, companyId) {
        if (email === 'a@example.test' && companyId === 'CO-A') {
          return { actor_id: 'actor-A', email, company_id: 'CO-A', role: 'COMPANY_ADMIN', active: true };
        }
        if (email === 'b@example.test' && companyId === 'CO-B') {
          return { actor_id: 'actor-B', email, company_id: 'CO-B', role: 'COMPANY_ADMIN', active: true };
        }
        return null;
      }
    }
  });
  function actor(email, companyId) {
    const invocation = {};
    identities.set(invocation, email);
    return resolver.resolve(invocation, companyId);
  }
  const platformStore = {
    getCompany(id) {
      if (options.registryFailure) throw new Error('private registry failure');
      return companies.get(id) || null;
    }
  };
  const deps = {
    actorResolver: resolver,
    platformStore,
    getFolderById: id => folders.get(id) || null,
    getFileById: id => files.get(id) || null,
    openWorkbookById: id => workbooks.get(id) || null,
    createStore: id => ({ workbookId: id })
  };
  return { context, companies, folders, files, workbooks, resolver, deps, actor };
}

test('Company A resolves only its registry-bound workbook and Drive folder', () => {
  const f = fixture();
  const tenant = f.context.resolveTenantResources('CO-A', f.actor('a@example.test', 'CO-A'), f.deps);
  assert.equal(tenant.company_id, 'CO-A');
  assert.equal(tenant.workbook_ref.getId(), 'workbook-A');
  assert.equal(tenant.drive_folder_ref.getId(), 'folder-A');
  assert.equal(tenant.store.workbookId, 'workbook-A');
});

test('Company A actor cannot resolve Company B resources by changing company ID', () => {
  const f = fixture();
  assert.throws(
    () => f.context.resolveTenantResources('CO-B', f.actor('a@example.test', 'CO-A'), f.deps),
    error => error.code === 'TENANT_ACCESS_DENIED'
  );
});

test('caller-supplied extra workbook and folder IDs cannot override registry binding', () => {
  const f = fixture();
  const actor = f.actor('a@example.test', 'CO-A');
  const tenant = f.context.resolveTenantResources('CO-A', actor, f.deps, 'workbook-B', 'folder-B');
  assert.equal(tenant.store.workbookId, 'workbook-A');
  assert.equal(tenant.drive_folder_ref.getId(), 'folder-A');
});

test('unknown or disabled company is denied without resource fallback', () => {
  const f = fixture();
  const actor = f.actor('a@example.test', 'CO-A');
  assert.throws(() => f.context.resolveTenantResources('CO-UNKNOWN', actor, f.deps),
    error => error.code === 'TENANT_ACCESS_DENIED');
  f.companies.set('CO-A', { ...f.companies.get('CO-A'), status: 'DISABLED' });
  assert.throws(() => f.context.resolveTenantResources('CO-A', actor, f.deps),
    error => error.code === 'COMPANY_NOT_ACTIVE');
});

test('missing registry resource IDs fail closed', () => {
  const f = fixture();
  const actor = f.actor('a@example.test', 'CO-A');
  f.companies.set('CO-A', { company_id: 'CO-A', status: 'ACTIVE', drive_folder_id: '', workbook_id: '' });
  assert.throws(() => f.context.resolveTenantResources('CO-A', actor, f.deps),
    error => error.code === 'TENANT_RESOURCE_BINDING_MISSING');
});

test('foreign Drive folder marker is rejected', () => {
  const f = fixture({ folderDescription: 'FIKISHA-V2|company_id=CO-B|resource=operations-folder' });
  assert.throws(() => f.context.resolveTenantResources('CO-A', f.actor('a@example.test', 'CO-A'), f.deps),
    error => error.code === 'TENANT_FOLDER_BINDING_MISMATCH');
});

test('foreign workbook marker is rejected', () => {
  const f = fixture({ fileDescription: 'FIKISHA-V2|company_id=CO-B|resource=operations-workbook' });
  assert.throws(() => f.context.resolveTenantResources('CO-A', f.actor('a@example.test', 'CO-A'), f.deps),
    error => error.code === 'TENANT_WORKBOOK_BINDING_MISMATCH');
});

test('company config mismatch and schema mismatch fail closed', () => {
  const companyMismatch = fixture({ configCompanyId: 'CO-B' });
  assert.throws(() => companyMismatch.context.resolveTenantResources(
    'CO-A', companyMismatch.actor('a@example.test', 'CO-A'), companyMismatch.deps),
  error => error.code === 'COMPANY_CONFIG_MISMATCH');

  const schemaMismatch = fixture({ schemaVersion: '1' });
  assert.throws(() => schemaMismatch.context.resolveTenantResources(
    'CO-A', schemaMismatch.actor('a@example.test', 'CO-A'), schemaMismatch.deps),
  error => error.code === 'COMPANY_SCHEMA_VERSION_MISMATCH');
});

test('registry failure fails closed and does not select a default tenant', () => {
  const f = fixture({ registryFailure: true });
  assert.throws(() => f.context.resolveTenantResources(
    'CO-A', f.actor('a@example.test', 'CO-A'), f.deps),
  error => error.message !== 'private registry failure');
});
