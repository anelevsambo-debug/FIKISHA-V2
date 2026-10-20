/**
 * Idempotent Google Drive/Sheets resource provisioning primitives.
 * Call only from a trusted, authorized platform-admin workflow after resolving
 * the company identity from the platform store (never directly from a client payload).
 */
function createCompanyProvisioner(deps) {
  if(!deps||!deps.platformStore||!deps.templateSpreadsheetId||!deps.rootFolderId)throw new FikishaError("PROVISIONER_CONFIGURATION_REQUIRED");
  if(typeof DriveApp==="undefined"||typeof SpreadsheetApp==="undefined")throw new FikishaError("APPS_SCRIPT_RUNTIME_REQUIRED");
  var platformStore=deps.platformStore;
  function provision(companyId,actor) {
    if(!actor||actor.active!==true||actor.role!=="DEVELOPER"||actor.platform_admin!==true)throw new FikishaError("PLATFORM_ADMIN_REQUIRED");
    if(!isNonEmptyString(companyId))throw new FikishaError("COMPANY_ID_REQUIRED");
    var company=platformStore.getCompany(companyId);
    if(!company)throw new FikishaError("COMPANY_NOT_FOUND");
    if(company.status==="SUSPENDED")throw new FikishaError("COMPANY_SUSPENDED");
    var job=platformStore.getProvisioningJob(companyId)||{company_id:companyId,status:"PROVISIONING",created_at:new Date().toISOString()};
    platformStore.saveProvisioningJob(job);
    try {
      var folder;
      if(job.folder_id)folder=DriveApp.getFolderById(job.folder_id);
      else {
        var root=DriveApp.getFolderById(deps.rootFolderId);
        folder=root.createFolder("FIKISHA-"+companyId);
        job.folder_id=folder.getId();job.step="FOLDER_CREATED";platformStore.saveProvisioningJob(job);
      }
      var workbook;
      if(job.workbook_id)workbook=SpreadsheetApp.openById(job.workbook_id);
      else {
        var template=DriveApp.getFileById(deps.templateSpreadsheetId);
        var copy=template.makeCopy("FIKISHA-"+companyId+"-Operations",folder);
        job.workbook_id=copy.getId();job.step="WORKBOOK_COPIED";platformStore.saveProvisioningJob(job);
        workbook=SpreadsheetApp.openById(job.workbook_id);
      }
      if(typeof deps.initializeWorkbook!=="function")throw new FikishaError("WORKBOOK_INITIALIZER_REQUIRED");
      deps.initializeWorkbook(workbook,company);
      job.status="NEEDS_OWNER_ACTION";job.step="WORKBOOK_INITIALIZED";
      job.note="AppSheet app creation and real-user access verification are still required.";
      job.updated_at=new Date().toISOString();platformStore.saveProvisioningJob(job);
      platformStore.updateCompanyResources(companyId,{drive_folder_id:job.folder_id,workbook_id:job.workbook_id,onboarding_status:job.status});
      return {company_id:companyId,status:job.status,drive_folder_id:job.folder_id,workbook_id:job.workbook_id,appsheet_status:"NEEDS_OWNER_ACTION"};
    } catch(e) {
      job.status="FAILED";job.error_code=e&&e.code?e.code:"PROVISIONING_FAILED";job.updated_at=new Date().toISOString();
      platformStore.saveProvisioningJob(job);
      throw e;
    }
  }
  return Object.freeze({provision:provision});
}
