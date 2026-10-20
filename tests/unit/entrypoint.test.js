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

test('POST rejects caller-supplied identity and authority fields while unconfigured', () => {
  const c = loadEntrypoints();
  const forgedIdentity = {
    email: 'attacker@example.invalid',
    actor_id: 'platform-owner',
    role: 'PLATFORM_ADMIN',
    platform_admin: true,
    company_id: 'company-victim',
    active: true
  };
  const requests = [
    { parameter: forgedIdentity },
    {
      parameters: Object.fromEntries(
        Object.entries(forgedIdentity).map(([key, value]) => [key, [String(value)]])
      )
    },
    {
      postData: {
        type: 'application/json',
        contents: JSON.stringify(forgedIdentity)
      }
    },
    {
      parameter: forgedIdentity,
      postData: {
        type: 'application/json',
        contents: JSON.stringify(forgedIdentity)
      }
    }
  ];

  for (const request of requests) {
    const response = c.doPost(request);
    const payload = JSON.parse(response.text);

    assert.equal(response.mimeType, 'application/json');
    assert.equal(payload.ok, false);
    assert.equal(payload.code, 'WEBHOOK_NOT_CONFIGURED');
    assert.equal(payload.operationalApi, false);
    assert.equal(payload.liveWhatsApp, false);
  }
});
