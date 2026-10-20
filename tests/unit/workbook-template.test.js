const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function makeSheet(name) {
  const data = [];
  return {
    name,
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
            const targetRow = data[row - 1 + r] || (data[row - 1 + r] = []);
            valuesRow.forEach((value, c) => { targetRow[column - 1 + c] = value; });
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
    getSheetByName(name) { return sheets.get(name) || null; },
    insertSheet(name) {
      if (sheets.has(name)) throw new Error('Sheet already exists: ' + name);
      const sheet = makeSheet(name);
      sheets.set(name, sheet);
      return sheet;
    },
    getId() { return 'test-spreadsheet-id'; },
    _sheets: sheets
  };
}

function loadInitializer() {
  const context = vm.createContext({});
  for (const file of ['errors.js', 'workbookTemplate.js']) {
    const base = file === 'errors.js' ? '../../src/core/' : '../../src/companies/';
    vm.runInContext(fs.readFileSync(path.join(__dirname, base + file), 'utf8'), context);
  }
  return context;
}

test('empty company workbook initializes the required tabs and company identity', () => {
  const c = loadInitializer();
  const spreadsheet = makeSpreadsheet();
  const result = c.initializeCompanyWorkbook(spreadsheet, { company_id: 'company-a' });

  assert.equal(result.schema_version, '2');
  assert.equal(result.company_id, 'company-a');
  assert.equal(result.spreadsheet_id, 'test-spreadsheet-id');
  assert.deepEqual(Array.from(result.sheets), [
    'Deliveries', 'DeliveryEvents', 'Idempotency', 'ProofOfDelivery', 'Drivers', 'DriverOffers', 'NotificationOutbox', 'CompanyConfig'
  ]);
  assert.deepEqual(spreadsheet.getSheetByName('Deliveries').getRange(1, 1, 1, 3).getValues(), [
    ['delivery_id', 'company_id', 'status']
  ]);
  assert.deepEqual(spreadsheet.getSheetByName('CompanyConfig').getRange(1, 1, 3, 2).getValues(), [
    ['key', 'value'], ['company_id', 'company-a'], ['schema_version', '2']
  ]);
});

test('re-running initialization preserves existing delivery data', () => {
  const c = loadInitializer();
  const spreadsheet = makeSpreadsheet();
  c.initializeCompanyWorkbook(spreadsheet, { company_id: 'company-a' });
  const deliveries = spreadsheet.getSheetByName('Deliveries');
  const row = Array(20).fill('');
  row[0] = 'FK-1';
  row[1] = 'company-a';
  row[2] = 'RECEIVED';
  deliveries.getRange(2, 1, 1, row.length).setValues([row]);

  c.initializeCompanyWorkbook(spreadsheet, { company_id: 'company-a' });

  assert.deepEqual(deliveries.getRange(2, 1, 1, row.length).getValues(), [row]);
  assert.equal(spreadsheet._sheets.size, 8);
});

test('incompatible existing schema fails closed without overwriting its data', () => {
  const c = loadInitializer();
  const spreadsheet = makeSpreadsheet();
  const deliveries = spreadsheet.insertSheet('Deliveries');
  deliveries.getRange(1, 1, 2, 3).setValues([
    ['wrong_id', 'company_id', 'status'],
    ['keep-me', 'company-a', 'RECEIVED']
  ]);

  assert.throws(
    () => c.initializeCompanyWorkbook(spreadsheet, { company_id: 'company-a' }),
    error => error.code === 'SHEET_SCHEMA_MISMATCH'
  );
  assert.deepEqual(deliveries.getRange(1, 1, 2, 3).getValues(), [
    ['wrong_id', 'company_id', 'status'],
    ['keep-me', 'company-a', 'RECEIVED']
  ]);
});


test('existing workbook rejects an old schema version instead of silently upgrading it', () => {
  const c = loadInitializer();
  const spreadsheet = makeSpreadsheet();
  c.initializeCompanyWorkbook(spreadsheet, { company_id: 'company-a' });
  const config = spreadsheet.getSheetByName('CompanyConfig');
  config.getRange(3, 2, 1, 1).setValues([['1']]);

  assert.throws(
    () => c.initializeCompanyWorkbook(spreadsheet, { company_id: 'company-a' }),
    error => error.code === 'COMPANY_SCHEMA_VERSION_MISMATCH'
  );
});

test('existing workbook cannot be rebound to a different company', () => {
  const c = loadInitializer();
  const spreadsheet = makeSpreadsheet();
  c.initializeCompanyWorkbook(spreadsheet, { company_id: 'company-a' });

  assert.throws(
    () => c.initializeCompanyWorkbook(spreadsheet, { company_id: 'company-b' }),
    error => error.code === 'COMPANY_CONFIG_MISMATCH'
  );
});
