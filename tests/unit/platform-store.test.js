const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const headers = {
  Companies: ['company_id', 'name', 'status', 'drive_folder_id', 'workbook_id', 'onboarding_status', 'created_at', 'updated_at'],
  CompanyMembers: ['actor_id', 'email', 'company_id', 'role', 'status', 'created_at', 'updated_at'],
  ProvisioningJobs: ['company_id', 'status', 'folder_id', 'workbook_id', 'step', 'note', 'error_code', 'created_at', 'updated_at']
};

function makeSheet(firstRow) {
  const data = [firstRow.slice()];
  return {
    getLastRow() { return data.length; },
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues() {
          return Array.from({ length: rowCount }, (_, r) =>
            Array.from({ length: columnCount }, (_, c) => (data[row - 1 + r] || [])[column - 1 + c] ?? '')
          );
        },
        setValues(values) {
          values.forEach((valuesRow, r) => {
            const target = data[row - 1 + r] || (data[row - 1 + r] = []);
            valuesRow.forEach((value, c) => { target[column - 1 + c] = value; });
          });
        }
      };
    },
    appendRow(row) { data.push(row.slice()); },
    _data: data
  };
}

function fixture() {
  const sheets = new Map(Object.entries(headers).map(([name, row]) => [name, makeSheet(row)]));
  const spreadsheet = { getSheetByName: name => sheets.get(name) || null };
  const context = vm.createContext({
    SpreadsheetApp: { openById: () => spreadsheet },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }
  });
  for (const file of ['errors.js', 'platformStore.js', 'actorResolver.js']) {
    const p = file === 'errors.js' || file === 'actorResolver.js'
      ? path.join(__dirname, '../../src/core', file)
      : path.join(__dirname, '../../src/platform', file);
    vm.runInContext(fs.readFileSync(p, 'utf8'), context);
  }
  const store = context.createPlatformStore('platform-workbook');
  return { context, store, sheets };
}

function addRow(sheet, values) {
  sheet.appendRow(values);
}

test('platform store resolves active membership by normalized email and company', () => {
  const f = fixture();
  addRow(f.sheets.get('CompanyMembers'), [
    'ACTOR-A', 'Admin@Example.test', 'CO-A', 'COMPANY_ADMIN', 'ACTIVE',
    '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'
  ]);

  const membership = f.store.getMembershipByEmail(' admin@example.test ', 'CO-A');
  assert.equal(membership.actor_id, 'ACTOR-A');
  assert.equal(membership.email, 'Admin@Example.test');
  assert.equal(membership.company_id, 'CO-A');
  assert.equal(membership.active, true);
  assert.equal(f.store.getMembershipByEmail('admin@example.test', 'CO-B'), null);
});

test('actor resolver can use the platform store membership adapter', () => {
  const f = fixture();
  addRow(f.sheets.get('CompanyMembers'), [
    'ACTOR-A', 'admin@example.test', 'CO-A', 'COMPANY_ADMIN', 'ACTIVE',
    '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'
  ]);
  const invocations = new WeakMap();
  const invocation = {};
  invocations.set(invocation, 'admin@example.test');
  const resolver = f.context.createTrustedActorResolver({
    getAuthenticatedEmail: context => invocations.get(context) || '',
    membershipStore: f.store
  });

  const actor = resolver.resolve(invocation, 'CO-A');
  assert.equal(actor.actor_id, 'ACTOR-A');
  assert.equal(actor.company_id, 'CO-A');
  assert.equal(resolver.isTrusted(actor), true);
});

test('inactive membership is returned as inactive for resolver denial', () => {
  const f = fixture();
  addRow(f.sheets.get('CompanyMembers'), [
    'ACTOR-A', 'admin@example.test', 'CO-A', 'COMPANY_ADMIN', 'SUSPENDED',
    '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'
  ]);
  const invocations = new WeakMap();
  const invocation = {};
  invocations.set(invocation, 'admin@example.test');
  const resolver = f.context.createTrustedActorResolver({
    getAuthenticatedEmail: context => invocations.get(context) || '',
    membershipStore: f.store
  });

  assert.throws(
    () => resolver.resolve(invocation, 'CO-A'),
    error => error.code === 'ACTOR_INACTIVE'
  );
});

test('duplicate membership records fail closed', () => {
  const f = fixture();
  const row = ['ACTOR-A', 'admin@example.test', 'CO-A', 'COMPANY_ADMIN', 'ACTIVE', '', ''];
  addRow(f.sheets.get('CompanyMembers'), row);
  addRow(f.sheets.get('CompanyMembers'), ['ACTOR-B', 'ADMIN@example.test', 'CO-A', 'DISPATCHER', 'ACTIVE', '', '']);

  assert.throws(
    () => f.store.getMembershipByEmail('admin@example.test', 'CO-A'),
    error => error.code === 'DUPLICATE_MEMBERSHIP_RECORD'
  );
});

test('provisioning job upsert preserves its original creation timestamp', () => {
  const f = fixture();
  f.store.saveProvisioningJob({
    company_id: 'CO-A', status: 'PROVISIONING', step: 'STARTED',
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z'
  });
  f.store.saveProvisioningJob({
    company_id: 'CO-A', status: 'NEEDS_OWNER_ACTION', step: 'WORKBOOK_INITIALIZED',
    updated_at: '2026-10-02T00:00:00.000Z'
  });

  const job = f.store.getProvisioningJob('CO-A');
  assert.equal(job.status, 'NEEDS_OWNER_ACTION');
  assert.equal(job.step, 'WORKBOOK_INITIALIZED');
  assert.equal(job.created_at, '2026-10-01T00:00:00.000Z');
  assert.equal(job.updated_at, '2026-10-02T00:00:00.000Z');
});

test('resource update preserves company status and updates only configured resources', () => {
  const f = fixture();
  addRow(f.sheets.get('Companies'), [
    'CO-A', 'Company A', 'ACTIVE', '', '', 'PENDING',
    '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'
  ]);

  const result = f.store.updateCompanyResources('CO-A', {
    drive_folder_id: 'folder-1', workbook_id: 'sheet-1', onboarding_status: 'NEEDS_OWNER_ACTION'
  });

  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.drive_folder_id, 'folder-1');
  assert.equal(result.workbook_id, 'sheet-1');
  assert.equal(result.onboarding_status, 'NEEDS_OWNER_ACTION');
});
