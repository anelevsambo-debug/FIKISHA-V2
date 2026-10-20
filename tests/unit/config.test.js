const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const c=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../../src/core/errors.js'),'utf8'),c);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../../src/core/config.js'),'utf8'),c);
test('unknown environment fails closed',()=>assert.throws(()=>c.readFikishaConfig(()=>''),e=>e.code==='INVALID_ENVIRONMENT'));
test('live WhatsApp requires credentials',()=>assert.throws(()=>c.readFikishaConfig(k=>({FIKISHA_ENV:'staging',FIKISHA_WHATSAPP_MODE:'META_CLOUD_API'}[k]||'')),e=>e.code==='WHATSAPP_CONFIGURATION_INCOMPLETE'));
test('disabled WhatsApp configuration can be read for staging',()=>{const v={FIKISHA_ENV:'staging',FIKISHA_WHATSAPP_MODE:'DISABLED'};assert.equal(c.readFikishaConfig(k=>v[k]||'').whatsappMode,'DISABLED');});
