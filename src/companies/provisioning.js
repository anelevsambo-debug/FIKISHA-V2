/**
 * Idempotent Google Drive/Sheets resource provisioning primitives.
 * Call only from a trusted, authorized platform-admin workflow after resolving
 * the company identity from the platform store (never directly from a client payload).
 */
function createCompanyProvisioner(deps) {
  if (!deps || !deps.platformStore || !deps.platformActorResolver ||
      typeof deps.platformActorResolver.assertTrusted !== "function" ||
      !deps.templateSpreadsheetId || !deps.rootFolderId) {
    throw new FikishaError("PROVISIONER_CONFIGURATION_REQUIRED");
  }
  if (typeof DriveApp === "undefined" || typeof SpreadsheetApp === "undefined") {
    throw new FikishaError("APPS_SCRIPT_RUNTIME_REQUIRED");
  }

  var platformStore = deps.platformStore;
  var log = typeof deps.logger === "function" ? deps.logger : function () {};

  function logReliability(event, code, step) {
    try { log({ component: "provisioning", event: event, code: code, step: step || "UNKNOWN" }); } catch (ignored) {}
  }

  function folderMarker(companyId) {
    return "FIKISHA-V2|company_id=" + companyId + "|resource=operations-folder";
  }

  function workbookMarker(companyId) {
    return "FIKISHA-V2|company_id=" + companyId + "|resource=operations-workbook";
  }

  function findUniqueFolder(parent, name, expectedDescription) {
    var iterator = parent.getFoldersByName(name);
    if (!iterator.hasNext()) return null;
    var folder = iterator.next();
    if (iterator.hasNext()) throw new FikishaError("DUPLICATE_PROVISIONING_FOLDER");
    if (folder.getDescription() !== expectedDescription) {
      throw new FikishaError("PROVISIONING_RESOURCE_IDENTITY_MISMATCH");
    }
    return folder;
  }

  function findUniqueWorkbook(folder, name, expectedDescription) {
    var iterator = folder.getFilesByName(name);
    if (!iterator.hasNext()) return null;
    var file = iterator.next();
    if (iterator.hasNext()) throw new FikishaError("DUPLICATE_PROVISIONING_WORKBOOK");
    if (file.getDescription() !== expectedDescription) {
      throw new FikishaError("PROVISIONING_RESOURCE_IDENTITY_MISMATCH");
    }
    return file;
  }

  function provisionUnlocked(companyId, actor) {
    deps.platformActorResolver.assertTrusted(actor);
    if (!actor || actor.active !== true || actor.role !== "DEVELOPER" || actor.platform_admin !== true) {
      throw new FikishaError("PLATFORM_ADMIN_REQUIRED");
    }
    if (!isNonEmptyString(companyId)) throw new FikishaError("COMPANY_ID_REQUIRED");

    var company = platformStore.getCompany(companyId);
    if (!company) throw new FikishaError("COMPANY_NOT_FOUND");
    if (company.company_id !== companyId) throw new FikishaError("COMPANY_REGISTRY_BINDING_MISMATCH");
    if (company.status !== "ACTIVE") throw new FikishaError("COMPANY_NOT_ACTIVE");

    var existingJob = platformStore.getProvisioningJob(companyId);
    if (existingJob && existingJob.company_id !== companyId) {
      throw new FikishaError("PROVISIONING_JOB_COMPANY_MISMATCH");
    }
    var job = existingJob || {
      company_id: companyId,
      status: "PROVISIONING",
      created_at: new Date().toISOString()
    };
    platformStore.saveProvisioningJob(job);

    try {
      var folderName = "FIKISHA-" + companyId;
      var expectedFolderDescription = folderMarker(companyId);
      var folder;

      if (job.folder_id) {
        folder = DriveApp.getFolderById(job.folder_id);
        if (folder.getDescription() !== expectedFolderDescription) {
          throw new FikishaError("PROVISIONING_RESOURCE_IDENTITY_MISMATCH");
        }
      } else {
        var root = DriveApp.getFolderById(deps.rootFolderId);
        folder = findUniqueFolder(root, folderName, expectedFolderDescription);
        if (!folder) {
          folder = root.createFolder(folderName);
          job.folder_id = folder.getId();
          folder.setDescription(expectedFolderDescription);
        } else {
          job.folder_id = folder.getId();
        }
        job.step = "FOLDER_CREATED";
        platformStore.saveProvisioningJob(job);
      }

      var workbookName = "FIKISHA-" + companyId + "-Operations";
      var expectedWorkbookDescription = workbookMarker(companyId);
      var workbook;

      if (job.workbook_id) {
        workbook = SpreadsheetApp.openById(job.workbook_id);
        var workbookFile = DriveApp.getFileById(job.workbook_id);
        if (workbookFile.getDescription() !== expectedWorkbookDescription) {
          throw new FikishaError("PROVISIONING_RESOURCE_IDENTITY_MISMATCH");
        }
      } else {
        var file = findUniqueWorkbook(folder, workbookName, expectedWorkbookDescription);
        if (!file) {
          var template = DriveApp.getFileById(deps.templateSpreadsheetId);
          file = template.makeCopy(workbookName, folder);
          job.workbook_id = file.getId();
          file.setDescription(expectedWorkbookDescription);
        } else {
          job.workbook_id = file.getId();
        }
        job.step = "WORKBOOK_COPIED";
        platformStore.saveProvisioningJob(job);
        workbook = SpreadsheetApp.openById(job.workbook_id);
      }

      if (typeof deps.initializeWorkbook !== "function") throw new FikishaError("WORKBOOK_INITIALIZER_REQUIRED");
      deps.initializeWorkbook(workbook, company);

      job.status = "NEEDS_OWNER_ACTION";
      job.step = "WORKBOOK_INITIALIZED";
      job.note = "AppSheet app creation and real-user access verification are still required.";
      job.updated_at = new Date().toISOString();
      platformStore.saveProvisioningJob(job);
      platformStore.updateCompanyResources(companyId, {
        drive_folder_id: job.folder_id,
        workbook_id: job.workbook_id,
        onboarding_status: job.status
      });
      return {
        company_id: companyId,
        status: job.status,
        drive_folder_id: job.folder_id,
        workbook_id: job.workbook_id,
        appsheet_status: "NEEDS_OWNER_ACTION"
      };
    } catch (error) {
      job.status = "FAILED";
      job.error_code = error && error.code ? error.code : "PROVISIONING_FAILED";
      job.updated_at = new Date().toISOString();
      try {
        platformStore.saveProvisioningJob(job);
      } catch (stateError) {
        throw new FikishaError("PROVISIONING_STATE_SAVE_FAILED");
      }
      throw error;
    }
  }

  function provision(companyId, actor) {
    try {
      var result = typeof platformStore.runExclusive === "function"
        ? platformStore.runExclusive(function () { return provisionUnlocked(companyId, actor); })
        : provisionUnlocked(companyId, actor);
      logReliability("provisioning_completed", "PROVISIONING_COMPLETED", "WORKBOOK_INITIALIZED");
      return result;
    } catch (error) {
      logReliability("provisioning_failed", error && error.code ? error.code : "PROVISIONING_FAILED", "UNKNOWN");
      throw error;
    }
  }

  return Object.freeze({ provision: provision });
}
