const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const c=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../../src/core/stateMachine.js'),'utf8'),c);
test('company admin cannot bypass lifecycle using arbitrary owner override',()=>{assert.equal(c.decideTransition('IN_TRANSIT','OWNER_OVERRIDE','COMPANY_ADMIN').ok,false);});
test('unknown roles cannot perform state transitions',()=>{assert.equal(c.decideTransition('RECEIVED','VALIDATE_OK','UNKNOWN').ok,false);});
