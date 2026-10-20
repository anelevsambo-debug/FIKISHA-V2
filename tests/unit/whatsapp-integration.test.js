const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture(options = {}) {
  const c = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/core/errors.js'), 'utf8'), c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/notifications/whatsappIntegration.js'), 'utf8'), c);
  const events = new Map(), notifications = new Map(), unmatched = [];
  let consent = true, attempts = 0, sendCount = 0, persistFailure = false;
  let now = '2026-10-20T12:00:00.000Z';
  const store = {
    recordWebhookEventUnique(key, event) {
      if (persistFailure) throw Object.assign(new Error('private persistence details'), {code:'SHEETS_WRITE_FAILED'});
      if (events.has(key)) return {status:'DUPLICATE'};
      events.set(key, event); return {status:'CREATED'};
    },
    getNotificationByProviderMessageId(id) {
      return Array.from(notifications.values()).find(n => n.provider_message_id === id) || null;
    },
    recordUnmatchedProviderStatus(e) { unmatched.push(e); },
    applyProviderStatus(id, providerId, status, timestamp, errors) {
      const n = notifications.get(id); n.provider_status=status; n.provider_status_at=timestamp; n.provider_errors=errors;
    },
    getNotification(id) { return notifications.get(id) || null; },
    claimNotificationForSend(id) {
      const n=notifications.get(id); if (!n || !['PENDING','RETRY'].includes(n.status)) return false;
      n.status='PROCESSING'; n.attempt_count=Number(n.attempt_count||0)+1; attempts++; return true;
    },
    markNotificationFailed(id, code) { const n=notifications.get(id); n.status='FAILED'; n.last_error_code=code; },
    markNotificationSuppressed(id, code) { const n=notifications.get(id); n.status='SUPPRESSED'; n.last_error_code=code; },
    markNotificationAccepted(id, providerId) { const n=notifications.get(id); n.status='SENT_TO_PROVIDER'; n.provider_message_id=providerId; },
    markNotificationOutcomeUnknown(id, code) { const n=notifications.get(id); n.status='OUTCOME_UNKNOWN'; n.last_error_code=code; },
    markNotificationRetry(id, code, count) { const n=notifications.get(id); n.status='RETRY'; n.last_error_code=code; n.attempt_count=count; }
  };
  const service = c.createWhatsAppIntegration({
    store, clock:()=>new Date(now), enabled: options.enabled !== false,
    verifySignature: (raw, sig) => sig === 'valid-signature',
    isAllowedProviderContext: (account, metadata) => account === 'WABA_TEST' && metadata.phone_number_id === 'PHONE_TEST',
    fingerprintPhone: p => p ? 'fp:' + p.slice(-4) : '',
    consentGate: () => consent,
    isTemplateApproved: key => key === 'DELIVERY_UPDATE_APPROVED',
    sender: (message, id) => {
      sendCount++;
      if (options.senderError) throw options.senderError;
      return {accepted:true, provider_message_id:'wamid.test.' + id};
    },
    maxAttempts: options.maxAttempts || 3,
    logger: () => {}
  });
  function payload(changeValue) {
    return JSON.stringify({object:'whatsapp_business_account',entry:[{id:'WABA_TEST',changes:[{field:'messages',value:{metadata:{phone_number_id:'PHONE_TEST'},...changeValue}}]}]});
  }
  function queue(overrides={}) {
    const n=Object.assign({notification_id:'N1',status:'PENDING',attempt_count:0,provider_message_id:'',payload_json:JSON.stringify({to:'+26771234567',purpose:'DELIVERY_SERVICE',template_key:'DELIVERY_UPDATE_APPROVED',language:'en'})},overrides);
    notifications.set(n.notification_id,n); return n;
  }
  return {service, store, events, notifications, unmatched, payload, queue, setConsent:v=>consent=v, setNow:v=>now=v, get attempts(){return attempts;},get sendCount(){return sendCount;},setPersistFailure:v=>persistFailure=v};
}

test('rejects missing authentication material and invalid signature before parsing', () => {
  const f=fixture();
  assert.throws(()=>f.service.receiveWebhook('{}',''), e=>e.code==='WEBHOOK_AUTH_MATERIAL_MISSING');
  assert.throws(()=>f.service.receiveWebhook('not-json','invalid'), e=>e.code==='WEBHOOK_SIGNATURE_INVALID');
  assert.equal(f.events.size,0);
});

test('rejects malformed authenticated webhook payload', () => {
  const f=fixture();
  assert.throws(()=>f.service.receiveWebhook('{','valid-signature'), e=>e.code==='WEBHOOK_JSON_INVALID');
  assert.throws(()=>f.service.receiveWebhook(JSON.stringify({object:'wrong',entry:[]}), 'valid-signature'), e=>e.code==='WEBHOOK_PAYLOAD_INVALID');
});

test('durably deduplicates repeated provider message events', () => {
  const f=fixture(), raw=f.payload({messages:[{id:'wamid.inbound.1',from:'26771234567',timestamp:'1792497600'}]});
  assert.equal(f.service.receiveWebhook(raw,'valid-signature').received,1);
  assert.equal(f.service.receiveWebhook(raw,'valid-signature').duplicates,1);
  assert.equal(f.events.size,1);
});

test('rejects duplicate webhook when durable persistence fails instead of acknowledging success', () => {
  const f=fixture(); f.setPersistFailure(true);
  assert.throws(()=>f.service.receiveWebhook(f.payload({messages:[{id:'wamid.inbound.2',from:'26771234567'}]}),'valid-signature'), e=>e.code==='WEBHOOK_EVENT_PERSISTENCE_FAILED' || e.code==='SHEETS_WRITE_FAILED');
});

test('status events cannot downgrade delivered/read and unmatched statuses are retained for reconciliation', () => {
  const f=fixture(); f.queue({provider_message_id:'wamid.out.1',status:'SENT_TO_PROVIDER',provider_status:'sent'});
  const status = (value, timestamp) => f.payload({statuses:[{id:'wamid.out.1',status:value,timestamp:String(timestamp),recipient_id:'26771234567'}]});
  f.service.receiveWebhook(status('delivered',200),'valid-signature');
  f.service.receiveWebhook(status('sent',100),'valid-signature');
  assert.equal(f.notifications.get('N1').provider_status,'delivered');
  f.service.receiveWebhook(status('read',300),'valid-signature');
  f.service.receiveWebhook(status('delivered',250),'valid-signature');
  assert.equal(f.notifications.get('N1').provider_status,'read');
  f.service.receiveWebhook(f.payload({statuses:[{id:'wamid.unknown',status:'delivered',timestamp:'400',recipient_id:'26770000000'}]}),'valid-signature');
  assert.equal(f.unmatched.length,1);
});

test('checks current consent at send time and suppresses queued messages after opt-out', () => {
  const f=fixture(); f.queue(); f.setConsent(false);
  assert.throws(()=>f.service.sendQueued('N1'), e=>e.code==='CONSENT_NOT_VALID');
  assert.equal(f.notifications.get('N1').status,'SUPPRESSED');
  assert.equal(f.sendCount,0);
});

test('blocks missing consent, invalid destination, unapproved template and marketing', () => {
  let f=fixture(); f.queue(); f.setConsent(false);
  assert.throws(()=>f.service.sendQueued('N1'), e=>e.code==='CONSENT_NOT_VALID');
  f=fixture(); f.queue({payload_json:JSON.stringify({to:'not-a-number',purpose:'DELIVERY_SERVICE',template_key:'DELIVERY_UPDATE_APPROVED'})});
  assert.throws(()=>f.service.sendQueued('N1'), e=>e.code==='INVALID_DESTINATION');
  f=fixture(); f.queue({payload_json:JSON.stringify({to:'+26771234567',purpose:'DELIVERY_SERVICE',template_key:'NOT_APPROVED'})});
  assert.throws(()=>f.service.sendQueued('N1'), e=>e.code==='TEMPLATE_NOT_APPROVED');
  f=fixture(); f.queue({payload_json:JSON.stringify({to:'+26771234567',purpose:'MARKETING',template_key:'DELIVERY_UPDATE_APPROVED'})});
  assert.throws(()=>f.service.sendQueued('N1'), e=>e.code==='MARKETING_DISABLED');
});

test('rejects invalid phone data in inbound event', () => {
  const f=fixture();
  assert.throws(()=>f.service.receiveWebhook(f.payload({messages:[{id:'wamid.bad',from:'not-a-phone'}]}),'valid-signature'), e=>e.code==='WEBHOOK_MESSAGE_INVALID');
});

test('provider acceptance is not treated as delivery; stores provider message id', () => {
  const f=fixture(); f.queue();
  const r=f.service.sendQueued('N1');
  assert.equal(r.status,'SENT_TO_PROVIDER');
  assert.equal(f.notifications.get('N1').provider_message_id,'wamid.test.N1');
  assert.equal(f.notifications.get('N1').provider_status,undefined);
});

test('timeout after provider acceptance becomes OUTCOME_UNKNOWN and is not blindly retried', () => {
  const f=fixture({senderError:Object.assign(new Error('timeout'),{code:'PROVIDER_TIMEOUT'})}); f.queue();
  const r=f.service.sendQueued('N1');
  assert.equal(r.status,'OUTCOME_UNKNOWN');
  assert.equal(r.retry,false);
  assert.equal(f.notifications.get('N1').status,'OUTCOME_UNKNOWN');
});

test('permanent errors fail and transient failures exhaust retry budget', () => {
  let f=fixture({senderError:Object.assign(new Error('bad request'),{code:'TEMPLATE_INVALID',permanent:true})}); f.queue();
  assert.equal(f.service.sendQueued('N1').status,'FAILED');
  f=fixture({senderError:Object.assign(new Error('temporary'),{code:'RATE_LIMITED'}),maxAttempts:1}); f.queue();
  assert.equal(f.service.sendQueued('N1').status,'FAILED');
  assert.equal(f.notifications.get('N1').last_error_code,'RETRY_EXHAUSTED');
});

test('outbound stays disabled when integration flag is false', () => {
  const f=fixture({enabled:false}); f.queue();
  assert.throws(()=>f.service.sendQueued('N1'), e=>e.code==='WHATSAPP_OUTBOUND_DISABLED');
});
