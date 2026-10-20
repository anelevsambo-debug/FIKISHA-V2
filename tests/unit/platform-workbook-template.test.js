const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function makeSheet() {
  const data = [];
  return {
    getLastRow() {
      for (let i = data.length - 1; i >= 0; i--) {
        if ((data[i] || []).some(value => value !== '' && value !== null && value !== undefined)) return i + 1;
      }
      return 0;
    },
    getLastColumn() {
      let last = 0;
      data.forEach(row => (row || []).forEach((value, i) => {
        if (value !== '' && value !== null && value !== undefined) last = Math.max(last, i + 1);
      }));
      return last;
    },
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
    setFrozenRows() {},
    _data: data
  };
}

function makeSpreadsheet() {
  const sheets = new Map();
  return {
    getSheetByName: name => sheets.get(name) || null,
    insertSheet(name) {
      if (sheets.has(name)) throw new Error('Sheet already exists: ' + name);
      const sheet = makeSheet();
      sheets.set(name, sheet);
      return sheet;
    },
    getId() { return 'platform-test-id'; },
    _sheets: sheets
  };
}

function loadInitializer() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/core/errors.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/platform/platformWorkbookTemplate.js'), 'utf8'), context);
  return context;
}

test('empty platform workbook initializes the registry sheets and schema version', () => {
  const c = loadInitializer();
  const spreadsheet = makeSpreadsheet();
  const result = c.initializePlatformWorkbook(spreadsheet);

  assert.equal(result.spreadsheet_id, 'platform-test-id');
  assert.equal(result.schema_version, '2');
  assert.deepEqual(Array.from(result.sheets), ['Companies', 'CompanyMembers', 'PlatformAdmins', 'ProvisioningJobs', 'PlatformConfig']);
  assert.deepEqual(spreadsheet.getSheetByName('CompanyMembers').getRange(1, 1, 1, 7).getValues(), [
    ['actor_id', 'email', 'company_id', 'role', 'status', 'created_at', 'updated_at']
  ]);
  assert.deepEqual(spreadsheet.getSheetByName('PlatformConfig').getRange(1, 1, 2, 2).getValues(), [
    ['key', 'value'], ['schema_version', '2']
  ]);
});

test('repeat initialization preserves existing platform records', () => {
  const c = loadInitializer();
  const spreadsheet = makeSpreadsheet();
  c.initializePlatformWorkbook(spreadsheet);
  const companies = spreadsheet.getSheetByName('Companies');
  const row = ['CO-A', 'Company A', 'ACTIVE', '', '', 'PENDING', 'created', 'updated'];
  companies.getRange(2, 1, 1, row.length).setValues([row]);

  c.initializePlatformWorkbook(spreadsheet);

  assert.deepEqual(companies.getRange(2, 1, 1, row.length).getValues(), [row]);
  assert.equal(spreadsheet._sheets.size, 5);
});

test('incompatible platform schema fails closed without overwriting existing rows', () => {
  const c = loadInitializer();
  const spreadsheet = makeSpreadsheet();
  const members = spreadsheet.insertSheet('CompanyMembers');
  members.getRange(1, 1, 2, 3).setValues([
    ['wrong_actor', 'email', 'company_id'],
    ['KEEP', 'admin@example.test', 'CO-A']
  ]);

  assert.throws(
    () => c.initializePlatformWorkbook(spreadsheet),
    error => error.code === 'PLATFORM_SHEET_SCHEMA_MISMATCH'
  );
  assert.deepEqual(members.getRange(1, 1, 2, 3).getValues(), [
    ['wrong_actor', 'email', 'company_id'],
    ['KEEP', 'admin@example.test', 'CO-A']
  ]);
});

test('old or missing platform schema version fails closed', () => {
  const c = loadInitializer();
  const spreadsheet = makeSpreadsheet();
  c.initializePlatformWorkbook(spreadsheet);
  const config = spreadsheet.getSheetByName('PlatformConfig');
  config.getRange(2, 2, 1, 1).setValues([['1']]);

  assert.throws(
    () => c.initializePlatformWorkbook(spreadsheet),
    error => error.code === 'PLATFORM_SCHEMA_VERSION_MISMATCH'
  );
});
