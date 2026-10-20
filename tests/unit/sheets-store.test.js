const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const headers = {
  Deliveries: ['delivery_id', 'company_id', 'status', 'sender_name', 'sender_phone', 'recipient_name', 'recipient_phone', 'pickup_text', 'dropoff_text', 'instructions', 'consent_status', 'created_at', 'updated_at', 'created_by', 'version', 'last_operation_id', 'driver_id', 'proof_id', 'delivered_at', 'failure_reason'],
  DeliveryEvents: ['event_id', 'company_id', 'delivery_id', 'event_type', 'actor_id', 'from_status', 'to_status', 'reason', 'proof_id', 'created_at'],
  Idempotency: ['key', 'result_json', 'created_at'],
  ProofOfDelivery: ['proof_id', 'delivery_id', 'company_id', 'verified', 'created_at'],
  Drivers: ['driver_id', 'company_id', 'status']
};

function makeSheet(name, firstRow) {
  const data = [firstRow.slice()];
  return {
    name,
    getLastRow() { return data.length; },
    getLastColumn() { return Math.max(0, ...data.map(row => row.length)); },
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

function fixture(options = {}) {
  const sheets = new Map(Object.entries(headers).map(([name, row]) => [name, makeSheet(name, row)]));
  const spreadsheet = {
    getSheetByName: name => sheets.get(name) || null,
    insertSheet(name) {
      const sheet = makeSheet(name, []);
      sheets.set(name, sheet);
      return sheet;
    }
  };
  const context = vm.createContext({
    SpreadsheetApp: { openById: () => spreadsheet },
    LockService: {
      getScriptLock: () => options.lockFactory ? options.lockFactory() : ({
        waitLock() {},
        releaseLock() {}
      })
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/core/errors.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/google/sheetsStore.js'), 'utf8'), context);
  const logger = options.logger || function () {};
  return { context, sheets, store: context.createSheetsStore('test-workbook', null, logger) };
}

test('idempotency reservation keeps one key and completion preserves original creation timestamp', () => {
  const f = fixture();
  const createdAt = '2026-10-20T00:00:00.000Z';
  const first = { state: 'IN_PROGRESS', operation_id: 'D-1', created_at: createdAt };
  const second = { state: 'IN_PROGRESS', operation_id: 'D-2', created_at: '2026-10-20T00:01:00.000Z' };

  assert.equal(f.store.reserveIdempotency('CO-A:req-1', first).created, true);
  const duplicate = f.store.reserveIdempotency('CO-A:req-1', second);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.record.operation_id, 'D-1');
  assert.equal(f.sheets.get('Idempotency')._data.length, 2);

  f.store.completeIdempotency('CO-A:req-1', {
    state: 'COMPLETED',
    operation_id: 'D-1',
    result: { delivery_id: 'D-1' },
    created_at: createdAt,
    updated_at: '2026-10-20T00:02:00.000Z'
  });

  const stored = f.sheets.get('Idempotency')._data[1];
  assert.equal(stored[2], createdAt);
  assert.equal(JSON.parse(stored[1]).state, 'COMPLETED');
});

test('delivery insert is idempotent by delivery ID', () => {
  const f = fixture();
  const delivery = {
    delivery_id: 'D-1', company_id: 'CO-A', status: 'RECEIVED',
    created_at: '2026-10-20T00:00:00.000Z', created_by: 'admin-a', version: 1, last_operation_id: 'OP-1'
  };

  assert.equal(f.store.ensureDelivery(delivery).created, true);
  assert.equal(f.store.ensureDelivery(delivery).created, false);
  assert.equal(f.sheets.get('Deliveries')._data.length, 2);
});

test('event append is idempotent by event ID and rejects conflicting reuse', () => {
  const f = fixture();
  const event = {
    event_id: 'E-1', company_id: 'CO-A', delivery_id: 'D-1',
    event_type: 'DELIVERY_CREATED', actor_id: 'admin-a',
    from_status: '', to_status: 'RECEIVED', reason: '', proof_id: '',
    created_at: '2026-10-20T00:00:00.000Z'
  };

  assert.equal(f.store.ensureEvent(event).created, true);
  assert.equal(f.store.ensureEvent(event).created, false);
  assert.equal(f.sheets.get('DeliveryEvents')._data.length, 2);
  assert.throws(
    () => f.store.ensureEvent(Object.assign({}, event, { delivery_id: 'D-2' })),
    error => error.code === 'EVENT_ID_CONFLICT'
  );
});

test('duplicate delivery IDs across tenants fail closed instead of selecting the first row', () => {
  const f = fixture();
  const rowA = Array(20).fill('');
  rowA[0] = 'SHARED-ID'; rowA[1] = 'CO-A'; rowA[2] = 'RECEIVED'; rowA[14] = 1;
  const rowB = Array(20).fill('');
  rowB[0] = 'SHARED-ID'; rowB[1] = 'CO-B'; rowB[2] = 'RECEIVED'; rowB[14] = 1;
  f.sheets.get('Deliveries').appendRow(rowA);
  f.sheets.get('Deliveries').appendRow(rowB);

  assert.throws(
    () => f.store.getDelivery('SHARED-ID'),
    error => error.code === 'DUPLICATE_DELIVERY_RECORD'
  );
  assert.throws(
    () => f.store.ensureDelivery({ delivery_id: 'SHARED-ID', company_id: 'CO-B' }),
    error => error.code === 'DUPLICATE_DELIVERY_RECORD'
  );
});

test('ensureDelivery rejects a delivery ID already bound to another company', () => {
  const f = fixture();
  const row = Array(20).fill('');
  row[0] = 'D-FOREIGN'; row[1] = 'CO-B'; row[2] = 'RECEIVED'; row[14] = 1;
  f.sheets.get('Deliveries').appendRow(row);

  assert.throws(
    () => f.store.ensureDelivery({
      delivery_id: 'D-FOREIGN', company_id: 'CO-A', status: 'RECEIVED'
    }),
    error => error.code === 'DELIVERY_ID_CONFLICT'
  );
  assert.equal(f.sheets.get('Deliveries')._data.length, 2);
});

test('saveDelivery rejects a tenant change and does not overwrite the foreign row', () => {
  const f = fixture();
  const row = Array(20).fill('');
  row[0] = 'D-FOREIGN'; row[1] = 'CO-B'; row[2] = 'RECEIVED'; row[14] = 1;
  f.sheets.get('Deliveries').appendRow(row);

  assert.throws(
    () => f.store.saveDelivery({
      delivery_id: 'D-FOREIGN', company_id: 'CO-A', status: 'CANCELLED', version: 2
    }, 1),
    error => error.code === 'TENANT_MISMATCH'
  );
  assert.equal(f.sheets.get('Deliveries')._data[1][1], 'CO-B');
  assert.equal(f.sheets.get('Deliveries')._data[1][2], 'RECEIVED');
});


test('lock acquisition timeout fails closed, does not run the write, and emits a safe structured log', () => {
  const logs = [];
  let releaseCalls = 0;
  const f = fixture({
    logger: event => logs.push(event),
    lockFactory: () => ({
      waitLock() { throw new Error('private runtime detail'); },
      releaseLock() { releaseCalls += 1; }
    })
  });

  assert.throws(
    () => f.store.reserveIdempotency('CO-A:timeout', { operation_id: 'OP-1' }),
    error => error.code === 'LOCK_ACQUISITION_TIMEOUT'
  );
  assert.equal(f.sheets.get('Idempotency')._data.length, 1);
  assert.equal(releaseCalls, 0);
  assert.deepEqual(logs, [{
    component: 'sheets_store',
    event: 'lock_acquisition_failed',
    code: 'LOCK_ACQUISITION_TIMEOUT'
  }]);
  assert.equal(JSON.stringify(logs).includes('private runtime detail'), false);
});

test('lock release failure is observable and does not mask a failed write operation', () => {
  const logs = [];
  const f = fixture({
    logger: event => logs.push(event),
    lockFactory: () => ({
      waitLock() {},
      releaseLock() { throw new Error('private release detail'); }
    })
  });

  assert.throws(
    () => f.store.reserveIdempotency('CO-A:release', { operation_id: 'OP-1' }),
    error => error.code === 'LOCK_RELEASE_FAILED'
  );
  assert.equal(f.sheets.get('Idempotency')._data.length, 2);
  assert.equal(logs[0].event, 'lock_release_failed');
  assert.equal(JSON.stringify(logs).includes('private release detail'), false);
});

test('duplicate persisted idempotency keys fail closed instead of selecting an arbitrary record', () => {
  const f = fixture();
  const row = ['CO-A:duplicate', JSON.stringify({ state: 'IN_PROGRESS', operation_id: 'OP-1' }), '2026-10-20T00:00:00.000Z'];
  f.sheets.get('Idempotency').appendRow(row);
  f.sheets.get('Idempotency').appendRow(['CO-A:duplicate', JSON.stringify({ state: 'COMPLETED', operation_id: 'OP-2' }), '2026-10-20T00:01:00.000Z']);

  assert.throws(
    () => f.store.getIdempotency('CO-A:duplicate'),
    error => error.code === 'DUPLICATE_IDEMPOTENCY_KEY'
  );
  assert.throws(
    () => f.store.reserveIdempotency('CO-A:duplicate', { operation_id: 'OP-3' }),
    error => error.code === 'DUPLICATE_IDEMPOTENCY_KEY'
  );
});


test('runExclusive holds one lock across nested store writes and releases it once', () => {
  let acquisitions = 0;
  let releases = 0;
  const f = fixture({
    lockFactory: () => ({
      waitLock(timeoutMs) {
        acquisitions += 1;
        assert.equal(timeoutMs, 10000);
      },
      releaseLock() { releases += 1; }
    })
  });

  f.store.runExclusive(() => {
    f.store.reserveIdempotency('CO-A:outer-lock', { operation_id: 'OP-1' });
    f.store.ensureEvent({
      event_id: 'E-OUTER', company_id: 'CO-A', delivery_id: 'D-1',
      event_type: 'TEST', actor_id: 'A-1', from_status: '', to_status: '',
      reason: '', proof_id: '', created_at: '2026-10-20T00:00:00.000Z'
    });
  });

  assert.equal(acquisitions, 1);
  assert.equal(releases, 1);
  assert.equal(f.sheets.get('Idempotency')._data.length, 2);
  assert.equal(f.sheets.get('DeliveryEvents')._data.length, 2);
});
