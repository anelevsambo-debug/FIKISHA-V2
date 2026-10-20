/**
 * Platform-registry Sheets adapter.
 *
 * This adapter reads server-controlled company and membership records. It does not
 * authenticate a caller; actorResolver must receive email from a separately trusted
 * authentication provider and then use getMembershipByEmail to authorize company access.
 */
function createPlatformStore(spreadsheetId, lockFactory, logger) {
  if (typeof spreadsheetId !== "string" || !spreadsheetId.trim()) throw new FikishaError("PLATFORM_WORKBOOK_ID_REQUIRED");
  if (typeof SpreadsheetApp === "undefined") throw new FikishaError("APPS_SCRIPT_RUNTIME_REQUIRED");

  var ss = SpreadsheetApp.openById(spreadsheetId);
  var lockProvider = lockFactory || function () { return LockService.getScriptLock(); };
  var log = typeof logger === "function" ? logger : function () {};
  var lockDepth = 0;
  var companyHeaders = ["company_id", "name", "status", "drive_folder_id", "workbook_id", "onboarding_status", "created_at", "updated_at"];
  var memberHeaders = ["actor_id", "email", "company_id", "role", "status", "created_at", "updated_at"];
  var platformAdminHeaders = ["actor_id", "email", "status", "created_at", "updated_at"];
  var jobHeaders = ["company_id", "status", "folder_id", "workbook_id", "step", "note", "error_code", "created_at", "updated_at"];

  function logReliability(event, code) {
    try { log({ component: "platform_store", event: event, code: code }); } catch (ignored) {}
  }

  function withLock(work) {
    if (lockDepth > 0) {
      lockDepth += 1;
      try { return work(); } finally { lockDepth -= 1; }
    }
    var lock;
    try { lock = lockProvider(); }
    catch (error) {
      logReliability("lock_unavailable", "LOCK_UNAVAILABLE");
      throw new FikishaError("LOCK_UNAVAILABLE");
    }
    try { lock.waitLock(10000); }
    catch (error) {
      logReliability("lock_acquisition_failed", "LOCK_ACQUISITION_TIMEOUT");
      throw new FikishaError("LOCK_ACQUISITION_TIMEOUT");
    }
    lockDepth = 1;
    var workFailed = false;
    try { return work(); }
    catch (error) { workFailed = true; throw error; }
    finally {
      lockDepth = 0;
      try { lock.releaseLock(); }
      catch (error) {
        logReliability("lock_release_failed", "LOCK_RELEASE_FAILED");
        if (!workFailed) throw new FikishaError("LOCK_RELEASE_FAILED");
      }
    }
  }

  function sheet(name, headers) {
    var sh = ss.getSheetByName(name);
    if (!sh) throw new FikishaError("REQUIRED_PLATFORM_SHEET_MISSING", name);
    var actual = sh.getRange(1, 1, 1, headers.length).getValues()[0];
    if (headers.some(function (header, index) { return actual[index] !== header; })) {
      throw new FikishaError("PLATFORM_SHEET_SCHEMA_MISMATCH", name);
    }
    return sh;
  }

  function rows(name, headers) {
    var sh = sheet(name, headers);
    var last = sh.getLastRow();
    if (last < 2) return [];
    return sh.getRange(2, 1, last - 1, headers.length).getValues().map(function (row) {
      var item = {};
      headers.forEach(function (header, index) { item[header] = row[index]; });
      return item;
    });
  }

  function rowValues(headers, item) {
    return headers.map(function (header) {
      return item[header] === undefined || item[header] === null ? "" : item[header];
    });
  }

  function findUnique(items, predicate, duplicateCode) {
    var matches = items.filter(predicate);
    if (matches.length > 1) throw new FikishaError(duplicateCode);
    return matches.length ? matches[0] : null;
  }

  function getCompany(companyId) {
    var company = findUnique(rows("Companies", companyHeaders), function (item) {
      return item.company_id === companyId;
    }, "DUPLICATE_COMPANY_RECORD");
    if (!company) return null;
    return {
      company_id: company.company_id,
      name: company.name,
      status: company.status,
      drive_folder_id: company.drive_folder_id,
      workbook_id: company.workbook_id,
      onboarding_status: company.onboarding_status,
      created_at: company.created_at,
      updated_at: company.updated_at
    };
  }

  function getMembershipByEmail(email, companyId) {
    var normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalizedEmail || typeof companyId !== "string" || !companyId.trim()) return null;
    var company = companyId.trim();
    var membership = findUnique(rows("CompanyMembers", memberHeaders), function (item) {
      return typeof item.email === "string" &&
        item.email.trim().toLowerCase() === normalizedEmail &&
        item.company_id === company;
    }, "DUPLICATE_MEMBERSHIP_RECORD");
    if (!membership) return null;
    return {
      actor_id: membership.actor_id,
      email: membership.email,
      company_id: membership.company_id,
      role: membership.role,
      active: membership.status === "ACTIVE",
      status: membership.status,
      created_at: membership.created_at,
      updated_at: membership.updated_at
    };
  }

  function getPlatformAdminByEmail(email) {
    var normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalizedEmail) return null;
    var admin = findUnique(rows("PlatformAdmins", platformAdminHeaders), function (item) {
      return typeof item.email === "string" && item.email.trim().toLowerCase() === normalizedEmail;
    }, "DUPLICATE_PLATFORM_ADMIN_RECORD");
    if (!admin) return null;
    return { actor_id: admin.actor_id, email: admin.email, active: admin.status === "ACTIVE", status: admin.status, created_at: admin.created_at, updated_at: admin.updated_at };
  }

  function getProvisioningJob(companyId) {
    var job = findUnique(rows("ProvisioningJobs", jobHeaders), function (item) {
      return item.company_id === companyId;
    }, "DUPLICATE_PROVISIONING_JOB");
    return job || null;
  }

  function saveProvisioningJob(job) {
    if (!job || typeof job.company_id !== "string" || !job.company_id.trim()) {
      throw new FikishaError("PROVISIONING_JOB_INVALID");
    }
    return withLock(function () {
      var all = rows("ProvisioningJobs", jobHeaders);
      var index = all.findIndex(function (item) { return item.company_id === job.company_id; });
      var prior = index >= 0 ? all[index] : null;
      var value = Object.assign({}, prior || {}, job, {
        created_at: (prior && prior.created_at) || job.created_at || new Date().toISOString(),
        updated_at: job.updated_at || new Date().toISOString()
      });
      if (index < 0) sheet("ProvisioningJobs", jobHeaders).appendRow(rowValues(jobHeaders, value));
      else sheet("ProvisioningJobs", jobHeaders).getRange(index + 2, 1, 1, jobHeaders.length).setValues([rowValues(jobHeaders, value)]);
      return value;
    });
  }

  function updateCompanyResources(companyId, resources) {
    if (!companyId || !resources) throw new FikishaError("COMPANY_RESOURCE_UPDATE_INVALID");
    return withLock(function () {
      var all = rows("Companies", companyHeaders);
      var index = all.findIndex(function (item) { return item.company_id === companyId; });
      if (index < 0) throw new FikishaError("COMPANY_NOT_FOUND");
      var updated = Object.assign({}, all[index], {
        drive_folder_id: resources.drive_folder_id || all[index].drive_folder_id || "",
        workbook_id: resources.workbook_id || all[index].workbook_id || "",
        onboarding_status: resources.onboarding_status || all[index].onboarding_status || "",
        updated_at: resources.updated_at || new Date().toISOString()
      });
      sheet("Companies", companyHeaders).getRange(index + 2, 1, 1, companyHeaders.length).setValues([rowValues(companyHeaders, updated)]);
      return updated;
    });
  }

  return Object.freeze({
    runExclusive: function (work) { if (typeof work !== "function") throw new FikishaError("LOCK_CALLBACK_REQUIRED"); return withLock(work); },
    getCompany: getCompany,
    getMembershipByEmail: getMembershipByEmail,
    getPlatformAdminByEmail: getPlatformAdminByEmail,
    getProvisioningJob: getProvisioningJob,
    saveProvisioningJob: saveProvisioningJob,
    updateCompanyResources: updateCompanyResources
  });
}
