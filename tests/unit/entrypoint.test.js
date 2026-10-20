const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadEntrypoints() {
  const context = vm.createContext({
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(text) {
        return {
          text,
          mimeType: null,
          setMimeType(value) {
            this.mimeType = value;
            return this;
          }
        };
      }
    }
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../../src/Code.js'), 'utf8'),
    context
  );
  return context;
}

test('GET status does not claim an operational API is configured', () => {
  const c = loadEntrypoints();
  const response = c.doGet({});
  const payload = JSON.parse(response.text);

  assert.equal(response.mimeType, 'application/json');
  assert.equal(payload.service, 'FIKISHA-V2');
  assert.equal(payload.status, 'not_configured');
  assert.equal(payload.operationalApi, false);
  assert.equal(payload.liveWhatsApp, false);
  assert.equal(payload.code, 'OPERATIONAL_API_NOT_CONFIGURED');
});

test('POST remains fail-closed until a secure webhook is implemented', () => {
  const c = loadEntrypoints();
  const response = c.doPost({});
  const payload = JSON.parse(response.text);

  assert.equal(response.mimeType, 'application/json');
  assert.equal(payload.ok, false);
  assert.equal(payload.code, 'WEBHOOK_NOT_CONFIGURED');
  assert.equal(payload.operationalApi, false);
  assert.equal(payload.liveWhatsApp, false);
});
