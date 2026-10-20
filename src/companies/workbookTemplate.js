var FikishaCompanySchema={
  Deliveries:["delivery_id","company_id","status","sender_name","sender_phone","recipient_name","recipient_phone","pickup_text","dropoff_text","instructions","consent_status","created_at","updated_at","created_by","version","driver_id","proof_id","delivered_at","failure_reason"],
  DeliveryEvents:["event_id","company_id","delivery_id","event_type","actor_id","from_status","to_status","reason","proof_id","created_at"],
  Idempotency:["key","result_json","created_at"],
  ProofOfDelivery:["proof_id","delivery_id","company_id","verified","created_at"],
  Drivers:["driver_id","company_id","status"]
};
/**
 * Idempotent structural initialization only. It does not grant access or create an AppSheet app.
 * Existing non-empty incompatible sheets fail closed; data is never cleared.
 */
function initializeCompanyWorkbook(spreadsheet,company) {
  if(!spreadsheet||!company||!company.company_id)throw new FikishaError("WORKBOOK_INIT_INPUT_REQUIRED");
  Object.keys(FikishaCompanySchema).forEach(function(name){
    var headers=FikishaCompanySchema[name],sh=spreadsheet.getSheetByName(name);
    if(!sh)sh=spreadsheet.insertSheet(name);
    var lastCol=sh.getLastColumn(),lastRow=sh.getLastRow();
    if(lastRow===0&&lastCol===0){sh.getRange(1,1,1,headers.length).setValues([headers]);sh.setFrozenRows(1);}
    else {
      if(lastCol<headers.length)throw new FikishaError("SHEET_SCHEMA_MISMATCH",name);
      var actual=sh.getRange(1,1,1,headers.length).getValues()[0];
      if(headers.some(function(h,i){return actual[i]!==h;}))throw new FikishaError("SHEET_SCHEMA_MISMATCH",name);
    }
  });
  var config=spreadsheet.getSheetByName("CompanyConfig");
  if(!config)config=spreadsheet.insertSheet("CompanyConfig");
  if(config.getLastRow()===0){config.getRange(1,1,3,2).setValues([["key","value"],["company_id",company.company_id],["schema_version","1"]]);config.setFrozenRows(1);}
  else {
    var rows=config.getRange(1,1,config.getLastRow(),2).getValues();
    var id=rows.find(function(r){return r[0]==="company_id";});
    if(!id||id[1]!==company.company_id)throw new FikishaError("COMPANY_CONFIG_MISMATCH");
  }
  return {company_id:company.company_id,spreadsheet_id:spreadsheet.getId(),schema_version:"1",sheets:Object.keys(FikishaCompanySchema).concat(["CompanyConfig"])};
}
