function makeTenantContext(c,w,d,store){if(!c||c.status!=="ACTIVE")throw new FikishaError("COMPANY_NOT_ACTIVE");if(!c.company_id||!w||!d||!store)throw new FikishaError("TENANT_CONTEXT_INCOMPLETE");return Object.freeze({company_id:c.company_id,workbook_ref:w,drive_folder_ref:d,store:store});}
function assertRowTenant(r,t){if(!r||!t||r.company_id!==t.company_id)throw new FikishaError("TENANT_MISMATCH");return true;}

/**
 * Resolve operational Google resources exclusively from the server-controlled
 * Companies registry after a trusted actor has been authorized for that company.
 * Caller-supplied workbook/folder IDs are deliberately not accepted by this API.
 */
function resolveTenantResources(companyId, actor, deps) {
  if (!deps || !deps.actorResolver || typeof deps.actorResolver.assertTrusted !== "function" ||
      !deps.platformStore || typeof deps.platformStore.getCompany !== "function" ||
      typeof deps.getFolderById !== "function" || typeof deps.getFileById !== "function" ||
      typeof deps.openWorkbookById !== "function" || typeof deps.createStore !== "function") {
    throw new FikishaError("TENANT_RESOURCE_DEPENDENCIES_REQUIRED");
  }

  deps.actorResolver.assertTrusted(actor);
  if (!actor || actor.active !== true || typeof companyId !== "string" ||
      !companyId.trim() || actor.company_id !== companyId.trim()) {
    throw new FikishaError("TENANT_ACCESS_DENIED");
  }

  var company = deps.platformStore.getCompany(companyId.trim());
  if (!company) throw new FikishaError("COMPANY_NOT_FOUND");
  if (company.company_id !== companyId.trim()) throw new FikishaError("COMPANY_REGISTRY_BINDING_MISMATCH");
  if (company.status !== "ACTIVE") throw new FikishaError("COMPANY_NOT_ACTIVE");
  if (typeof company.drive_folder_id !== "string" || !company.drive_folder_id.trim() ||
      typeof company.workbook_id !== "string" || !company.workbook_id.trim()) {
    throw new FikishaError("TENANT_RESOURCE_BINDING_MISSING");
  }

  var expectedFolderMarker = "FIKISHA-V2|company_id=" + company.company_id + "|resource=operations-folder";
  var expectedWorkbookMarker = "FIKISHA-V2|company_id=" + company.company_id + "|resource=operations-workbook";
  var folder = deps.getFolderById(company.drive_folder_id);
  if (!folder || folder.getId() !== company.drive_folder_id ||
      folder.getDescription() !== expectedFolderMarker) {
    throw new FikishaError("TENANT_FOLDER_BINDING_MISMATCH");
  }

  var workbookFile = deps.getFileById(company.workbook_id);
  if (!workbookFile || workbookFile.getId() !== company.workbook_id ||
      workbookFile.getDescription() !== expectedWorkbookMarker) {
    throw new FikishaError("TENANT_WORKBOOK_BINDING_MISMATCH");
  }

  var workbook = deps.openWorkbookById(company.workbook_id);
  if (!workbook || typeof workbook.getId !== "function" || workbook.getId() !== company.workbook_id) {
    throw new FikishaError("TENANT_WORKBOOK_BINDING_MISMATCH");
  }
  var config = workbook.getSheetByName("CompanyConfig");
  if (!config || typeof config.getLastRow !== "function" || config.getLastRow() < 2) {
    throw new FikishaError("TENANT_WORKBOOK_CONFIG_MISSING");
  }
  var configRows = config.getRange(1, 1, config.getLastRow(), 2).getValues();
  var companyConfig = configRows.find(function (row) { return row[0] === "company_id"; });
  var schemaConfig = configRows.find(function (row) { return row[0] === "schema_version"; });
  if (!companyConfig || companyConfig[1] !== company.company_id) {
    throw new FikishaError("COMPANY_CONFIG_MISMATCH");
  }
  if (!schemaConfig || String(schemaConfig[1]) !== "2") {
    throw new FikishaError("COMPANY_SCHEMA_VERSION_MISMATCH");
  }

  var store = deps.createStore(company.workbook_id);
  if (!store) throw new FikishaError("TENANT_STORE_BINDING_FAILED");
  return makeTenantContext(company, workbook, folder, store);
}
