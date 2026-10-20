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
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/companies/provisioning.js'), 'utf8'), context);

  const platform = {
    company: { company_id: 'CO-A', name: 'Company A', status: 'ACTIVE' },
    job: options.job || null,
    resources: null,
    getCompany(id) { return id === this.company.company_id ? this.company : null; },
    getProvisioningJob() { return this.job ? Object.assign({}, this.job) : null; },
    saveProvisioningJob(job) { this.job = Object.assign({}, job); },
    updateCompanyResources(id, resources) {
      if (id !== this.company.company_id) throw new Error('wrong company');
      this.resources = Object.assign({}, resources);
    }
  };
  const provisioner = context.createCompanyProvisioner({
    platformStore: platform,
    templateSpreadsheetId: 'template',
    rootFolderId: 'root',
    initializeWorkbook(spreadsheet, company) {
      if (!spreadsheet || company.company_id !== 'CO-A') throw new Error('unexpected initializer arguments');
    }
  });
  return { context, platform, provisioner, root, folders, files, workbooks, template, workbook };
}

const admin = { actor_id: 'platform-admin', role: 'DEVELOPER', active: true, platform_admin: true };
const folderMarker = 'FIKISHA-V2|company_id=CO-A|resource=operations-folder';
const workbookMarker = 'FIKISHA-V2|company_id=CO-A|resource=operations-workbook';

test('provisioner creates marked resources and persists completion state', () => {
  const f = fixture();
  const result = f.provisioner.provision('CO-A', admin);

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

  const result = f.provisioner.provision('CO-A', admin);

  assert.equal(result.drive_folder_id, 'folder-existing');
  assert.equal(result.workbook_id, 'file-existing');
  assert.equal(f.root.folders.length, 1);
  assert.equal(f.root.folders[0].files.length, 1);
  assert.equal(f.platform.job.status, 'NEEDS_OWNER_ACTION');
});

test('provisioner fails closed on an unmarked same-name folder', () => {
  const f = fixture({ existingFolder: true, existingFolderDescription: 'unrelated resource' });

  assert.throws(
    () => f.provisioner.provision('CO-A', admin),
    error => error.code === 'PROVISIONING_RESOURCE_IDENTITY_MISMATCH'
  );
  assert.equal(f.root.folders.length, 1);
});

test('provisioner fails closed on duplicate same-name folders', () => {
  const f = fixture({ existingFolder: true, existingFolderDescription: folderMarker });
  const duplicate = f.root.createFolder('FIKISHA-CO-A');
  duplicate.setDescription(folderMarker);

  assert.throws(
    () => f.provisioner.provision('CO-A', admin),
    error => error.code === 'DUPLICATE_PROVISIONING_FOLDER'
  );
  assert.equal(f.root.folders.length, 2);
});

test('provisioner rejects a non-platform administrator', () => {
  const f = fixture();
  assert.throws(
    () => f.provisioner.provision('CO-A', { actor_id: 'user', role: 'COMPANY_ADMIN', active: true }),
    error => error.code === 'PLATFORM_ADMIN_REQUIRED'
  );
});
