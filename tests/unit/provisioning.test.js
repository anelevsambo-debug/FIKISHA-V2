const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function iterator(items) {
  let index = 0;
  return {
    hasNext() { return index < items.length; },
    next() {
      if (index >= items.length) throw new Error('No next item');
      return items[index++];
    }
  };
}

function fixture(options = {}) {
  const folders = new Map();
  const files = new Map();
  const workbooks = new Map();
  let folderCounter = 0;
  let fileCounter = 0;

  function makeFolder(id, name, description = '') {
    const folder = {
      id, name, description, folders: [], files: [],
      getId() { return this.id; },
      getName() { return this.name; },
      getDescription() { return this.description; },
      setDescription(value) { this.description = value; },
      getFoldersByName(value) { return iterator(this.folders.filter(item => item.name === value)); },
      getFilesByName(value) { return iterator(this.files.filter(item => item.name === value)); },
      createFolder(value) {
        const created = makeFolder('folder-' + (++folderCounter), value);
        this.folders.push(created);
        return created;
      }
    };
    folders.set(id, folder);
    return folder;
  }

  function makeFile(id, name, description = '') {
    const file = {
      id, name, description,
      getId() { return this.id; },
      getName() { return this.name; },
      getDescription() { return this.description; },
      setDescription(value) { this.description = value; },
      makeCopy(copyName, folder) {
        const copy = makeFile('file-' + (++fileCounter), copyName);
        folder.files.push(copy);
        workbooks.set(copy.id, { id: copy.id });
        return copy;
      }
    };
    files.set(id, file);
    return file;
  }

  const root = makeFolder('root', 'FIKISHA-ROOT');
  if (options.existingFolder) {
    const folder = makeFolder('folder-existing', 'FIKISHA-CO-A', options.existingFolderDescription || '');
    root.folders.push(folder);
    if (options.existingWorkbook) {
      const file = makeFile('file-existing', 'FIKISHA-CO-A-Operations', options.existingWorkbookDescription || '');
      folder.files.push(file);
      workbooks.set(file.id, { id: file.id });
    }
  }
  const template = makeFile('template', 'template');
  const workbook = { id: 'unused' };
  const context = vm.createContext({
    DriveApp: {
      getFolderById(id) {
        const value = folders.get(id);
        if (!value) throw new Error('Folder not found');
        return value;
      },
      getFileById(id) {
        const value = files.get(id);
        if (!value) throw new Error('File not found');
        return value;
      }
    },
    SpreadsheetApp: {
      openById(id) {
        const value = workbooks.get(id);
        if (!value) throw new Error('Workbook not found');
        return value;
      }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/core/errors.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/core/validators.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/core/actorResolver.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/companies/provisioning.js'), 'utf8'), context);

  let saveJobCalls = 0;
  const failSaveCalls = new Set(options.failSaveCalls || []);
  const platform = {
    company: options.company || { company_id: 'CO-A', name: 'Company A', status: 'ACTIVE' },
    job: options.job || null,
    resources: null,
    getCompany(id) { return options.company ? this.company : (id === this.company.company_id ? this.company : null); },
    getProvisioningJob() { return this.job ? Object.assign({}, this.job) : null; },
    saveProvisioningJob(job) {
      saveJobCalls += 1;
      if (failSaveCalls.has(saveJobCalls)) throw Object.assign(new Error('simulated registry write failure'), { code: 'SIMULATED_REGISTRY_WRITE_FAILURE' });
      this.job = Object.assign({}, job);
    },
    updateCompanyResources(id, resources) {
      if (id !== this.company.company_id) throw new Error('wrong company');
      this.resources = Object.assign({}, resources);
    }
  };
  const identities = new WeakMap();
  const actorResolver = context.createTrustedActorResolver({
    getAuthenticatedEmail: invocation => identities.get(invocation) || '',
    membershipStore: {
      getMembershipByEmail(email) {
        return email === 'company-admin@example.test'
          ? { actor_id: 'COMPANY-ADMIN', email: email, company_id: 'CO-A', role: 'COMPANY_ADMIN', active: true }
          : null;
      },
      getPlatformAdminByEmail(email) {
        return email === 'platform-admin@example.test'
          ? { actor_id: 'PLATFORM-ADMIN', email: email, active: true }
          : null;
      }
    }
  });
  const adminInvocation = {};
  identities.set(adminInvocation, 'platform-admin@example.test');
  const admin = actorResolver.resolvePlatformAdmin(adminInvocation);
  const companyInvocation = {};
  identities.set(companyInvocation, 'company-admin@example.test');
  const companyAdmin = actorResolver.resolve(companyInvocation, 'CO-A');

  const provisioner = context.createCompanyProvisioner({
    platformStore: platform,
    platformActorResolver: actorResolver,
    templateSpreadsheetId: 'template',
    rootFolderId: 'root',
    initializeWorkbook(spreadsheet, company) {
      if (!spreadsheet || company.company_id !== 'CO-A') throw new Error('unexpected initializer arguments');
    }
  });
  return { context, platform, provisioner, root, folders, files, workbooks, template, workbook, admin, companyAdmin };
}

const folderMarker = 'FIKISHA-V2|company_id=CO-A|resource=operations-folder';
const workbookMarker = 'FIKISHA-V2|company_id=CO-A|resource=operations-workbook';

test('provisioner creates marked resources and persists completion state', () => {
  const f = fixture();
  const result = f.provisioner.provision('CO-A', f.admin);

  assert.equal(result.status, 'NEEDS_OWNER_ACTION');
  assert.equal(result.drive_folder_id, 'folder-1');
  assert.equal(result.workbook_id, 'file-1');
  assert.equal(f.folders.get('folder-1').getDescription(), folderMarker);
  assert.equal(f.files.get('file-1').getDescription(), workbookMarker);
  assert.equal(f.platform.job.status, 'NEEDS_OWNER_ACTION');
  assert.equal(f.platform.resources.workbook_id, 'file-1');
});

test('provisioner reuses uniquely marked resources after a lost job reference', () => {
  const f = fixture({
    existingFolder: true,
    existingFolderDescription: folderMarker,
    existingWorkbook: true,
    existingWorkbookDescription: workbookMarker,
    job: { company_id: 'CO-A', status: 'FAILED', step: 'STARTED', created_at: '2026-10-01T00:00:00.000Z' }
  });

  const result = f.provisioner.provision('CO-A', f.admin);

  assert.equal(result.drive_folder_id, 'folder-existing');
  assert.equal(result.workbook_id, 'file-existing');
  assert.equal(f.root.folders.length, 1);
  assert.equal(f.root.folders[0].files.length, 1);
  assert.equal(f.platform.job.status, 'NEEDS_OWNER_ACTION');
});

test('provisioner fails closed on an unmarked same-name folder', () => {
  const f = fixture({ existingFolder: true, existingFolderDescription: 'unrelated resource' });

  assert.throws(
    () => f.provisioner.provision('CO-A', f.admin),
    error => error.code === 'PROVISIONING_RESOURCE_IDENTITY_MISMATCH'
  );
  assert.equal(f.root.folders.length, 1);
});

test('provisioner fails closed on duplicate same-name folders', () => {
  const f = fixture({ existingFolder: true, existingFolderDescription: folderMarker });
  const duplicate = f.root.createFolder('FIKISHA-CO-A');
  duplicate.setDescription(folderMarker);

  assert.throws(
    () => f.provisioner.provision('CO-A', f.admin),
    error => error.code === 'DUPLICATE_PROVISIONING_FOLDER'
  );
  assert.equal(f.root.folders.length, 2);
});

test('provisioner rejects a non-platform administrator', () => {
  const f = fixture();
  assert.throws(
    () => f.provisioner.provision('CO-A', { actor_id: 'user', role: 'DEVELOPER', active: true, platform_admin: true }),
    error => error.code === 'UNTRUSTED_ACTOR_CONTEXT'
  );
  assert.throws(
    () => f.provisioner.provision('CO-A', f.companyAdmin),
    error => error.code === 'PLATFORM_ADMIN_REQUIRED'
  );
});

test('provisioner rejects disabled companies before creating any resources', () => {
  const f = fixture({ company: { company_id: 'CO-A', name: 'Company A', status: 'DISABLED' } });
  assert.throws(
    () => f.provisioner.provision('CO-A', f.admin),
    error => error.code === 'COMPANY_NOT_ACTIVE'
  );
  assert.equal(f.root.folders.length, 0);
  assert.equal(f.platform.job, null);
});

test('provisioner rejects a mismatched registry company identity', () => {
  const f = fixture({ company: { company_id: 'CO-B', name: 'Company B', status: 'ACTIVE' } });
  assert.throws(
    () => f.provisioner.provision('CO-A', f.admin),
    error => error.code === 'COMPANY_REGISTRY_BINDING_MISMATCH'
  );
  assert.equal(f.root.folders.length, 0);
});

test('provisioner rejects a saved workbook ID bound to another company', () => {
  const f = fixture({
    existingFolder: true,
    existingFolderDescription: folderMarker,
    existingWorkbook: true,
    existingWorkbookDescription: 'FIKISHA-V2|company_id=CO-B|resource=operations-workbook',
    job: { company_id: 'CO-A', folder_id: 'folder-existing', workbook_id: 'file-existing', status: 'FAILED' }
  });
  assert.throws(
    () => f.provisioner.provision('CO-A', f.admin),
    error => error.code === 'PROVISIONING_RESOURCE_IDENTITY_MISMATCH'
  );
  assert.equal(f.platform.resources, null);
});

test('provisioner rejects a provisioning job bound to another company', () => {
  const f = fixture({ job: { company_id: 'CO-B', status: 'FAILED' } });
  assert.throws(
    () => f.provisioner.provision('CO-A', f.admin),
    error => error.code === 'PROVISIONING_JOB_COMPANY_MISMATCH'
  );
  assert.equal(f.root.folders.length, 0);
});


test('repeated provisioning reuses the same marked resources without duplicates', () => {
  const f = fixture();
  const first = f.provisioner.provision('CO-A', f.admin);
  const second = f.provisioner.provision('CO-A', f.admin);

  assert.equal(second.drive_folder_id, first.drive_folder_id);
  assert.equal(second.workbook_id, first.workbook_id);
  assert.equal(f.root.folders.length, 1);
  assert.equal(f.root.folders[0].files.length, 1);
  assert.equal(f.platform.resources.workbook_id, first.workbook_id);
});

test('retry recovers a marked folder when saving its identifier and failure state both fail', () => {
  const f = fixture({ failSaveCalls: [2, 3] });

  assert.throws(
    () => f.provisioner.provision('CO-A', f.admin),
    error => error.code === 'PROVISIONING_STATE_SAVE_FAILED'
  );
  assert.equal(f.root.folders.length, 1);
  assert.equal(f.root.folders[0].getDescription(), folderMarker);
  assert.equal(f.platform.job.folder_id, undefined);

  const recovered = f.provisioner.provision('CO-A', f.admin);
  assert.equal(recovered.drive_folder_id, 'folder-1');
  assert.equal(f.root.folders.length, 1);
  assert.equal(f.root.folders[0].files.length, 1);
  assert.equal(f.platform.job.status, 'NEEDS_OWNER_ACTION');
});

test('provisioning failures emit structured logs without exposing provider exception details', () => {
  const logs = [];
  const f = fixture({ company: { company_id: 'CO-A', name: 'Company A', status: 'DISABLED' } });
  // Reuse the resolver-branded actor from the original fixture through a minimal injected resolver.
  const resolver = { assertTrusted(actor) { if (actor !== f.admin) throw Object.assign(new Error('private provider detail'), { code: 'UNTRUSTED_ACTOR_CONTEXT' }); } };
  const safeLoggerProvisioner = f.context.createCompanyProvisioner({
    platformStore: f.platform,
    platformActorResolver: resolver,
    templateSpreadsheetId: 'template',
    rootFolderId: 'root',
    logger: event => logs.push(event),
    initializeWorkbook() {}
  });
  assert.throws(() => safeLoggerProvisioner.provision('CO-A', f.admin), error => error.code === 'COMPANY_NOT_ACTIVE');
  assert.equal(logs[0].event, 'provisioning_failed');
  assert.equal(logs[0].code, 'COMPANY_NOT_ACTIVE');
  assert.equal(JSON.stringify(logs).includes('private provider detail'), false);
});
