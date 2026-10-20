function createSheetsStore(spreadsheetId,lockFactory) {
  if(typeof spreadsheetId!=="string"||!spreadsheetId.trim())throw new FikishaError("WORKBOOK_ID_REQUIRED");
  if(typeof SpreadsheetApp==="undefined")throw new FikishaError("APPS_SCRIPT_RUNTIME_REQUIRED");
  var ss=SpreadsheetApp.openById(spreadsheetId), lockProvider=lockFactory||function(){return LockService.getScriptLock();};
  function sheet(name,headers){var sh=ss.getSheetByName(name);if(!sh)throw new FikishaError("REQUIRED_SHEET_MISSING",name);
    var actual=sh.getRange(1,1,1,headers.length).getValues()[0];if(headers.some(function(h,i){return actual[i]!==h;}))throw new FikishaError("SHEET_SCHEMA_MISMATCH",name);return sh;}
  function rows(name,headers){var sh=sheet(name,headers),last=sh.getLastRow();if(last<2)return [];
    return sh.getRange(2,1,last-1,headers.length).getValues().map(function(row){var o={};headers.forEach(function(h,i){o[h]=row[i];});return o;});}
  function append(name,headers,obj){var lock=lockProvider();lock.waitLock(10000);try{sheet(name,headers).appendRow(headers.map(function(h){return obj[h]===undefined?"":obj[h];}));}finally{lock.releaseLock();}}
  var dh=["delivery_id","company_id","status","sender_name","sender_phone","recipient_name","recipient_phone","pickup_text","dropoff_text","instructions","consent_status","created_at","updated_at","created_by","version","driver_id","proof_id","delivered_at","failure_reason"];
  var eh=["event_id","company_id","delivery_id","event_type","actor_id","from_status","to_status","reason","proof_id","created_at"];
  var ih=["key","result_json","created_at"];
  function getDelivery(id){return rows("Deliveries",dh).find(function(r){return r.delivery_id===id;})||null;}
  function saveDelivery(d,expected){var lock=lockProvider();lock.waitLock(10000);try{var sh=sheet("Deliveries",dh),all=rows("Deliveries",dh),i=all.findIndex(function(r){return r.delivery_id===d.delivery_id;});
    if(i<0)throw new FikishaError("DELIVERY_NOT_FOUND");if(Number(all[i].version)!==Number(expected))throw new FikishaError("CONCURRENT_UPDATE");
    sh.getRange(i+2,1,1,dh.length).setValues([dh.map(function(h){return d[h]===undefined?"":d[h];})]);}finally{lock.releaseLock();}}
  function getIdempotency(key){var r=rows("Idempotency",ih).find(function(x){return x.key===key;});if(!r)return null;try{return JSON.parse(r.result_json);}catch(e){throw new FikishaError("IDEMPOTENCY_RECORD_CORRUPT");}}
  return Object.freeze({getDelivery:getDelivery,
    insertDelivery:function(d){if(getDelivery(d.delivery_id))throw new FikishaError("DELIVERY_ID_CONFLICT");append("Deliveries",dh,d);},
    saveDelivery:saveDelivery,appendEvent:function(e){append("DeliveryEvents",eh,e);},
    getIdempotency:getIdempotency,saveIdempotency:function(k,v){append("Idempotency",ih,{key:k,result_json:JSON.stringify(v),created_at:v.created_at});},
    isProofVerified:function(p,d,c){return rows("ProofOfDelivery",["proof_id","delivery_id","company_id","verified","created_at"]).some(function(x){return x.proof_id===p&&x.delivery_id===d&&x.company_id===c&&String(x.verified).toUpperCase()==="TRUE";});},
    isActiveDriver:function(id,c){return rows("Drivers",["driver_id","company_id","status"]).some(function(x){return x.driver_id===id&&x.company_id===c&&x.status==="ACTIVE";});}
  });
}