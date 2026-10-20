var FikishaPlatformSchema = {
  Companies: ["company_id", "name", "status", "drive_folder_id", "workbook_id", "onboarding_status", "created_at", "updated_at"],
  CompanyMembers: ["actor_id", "email", "company_id", "role", "status", "created_at", "updated_at"],
  PlatformAdmins: ["actor_id", "email", "status", "created_at", "updated_at"],
  ProvisioningJobs: ["company_id", "status", "folder_id", "workbook_id", "step", "note", "error_code", "created_at", "updated_at"]
};

/**
 * Non-destructive initialization of the platform registry workbook.
 * This creates only missing sheets and refuses incompatible existing schemas.
 * It does not create companies, memberships, permissions or AppSheet apps.
 */
function initializePlatformWorkbook(spreadsheet) {
  if (!spreadsheet || typeof spreadsheet.getSheetByName !== "function") {
    throw new FikishaError("PLATFORM_WORKBOOK_REQUIRED");
  }

  Object.keys(FikishaPlatformSchema).forEach(function (name) {
    var headers = FikishaPlatformSchema[name];
    var sh = spreadsheet.getSheetByName(name);
    if (!sh) sh = spreadsheet.insertSheet(name);

    var lastRow = sh.getLastRow();
    var lastColumn = sh.getLastColumn();
    if (lastRow === 0 && lastColumn === 0) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
    } else {
      if (lastColumn < headers.length) throw new FikishaError("PLATFORM_SHEET_SCHEMA_MISMATCH", name);
      var actual = sh.getRange(1, 1, 1, headers.length).getValues()[0];
      if (headers.some(function (header, index) { return actual[index] !== header; })) {
        throw new FikishaError("PLATFORM_SHEET_SCHEMA_MISMATCH", name);
      }
    }
  });

  var config = spreadsheet.getSheetByName("PlatformConfig");
  if (!config) config = spreadsheet.insertSheet("PlatformConfig");
  if (config.getLastRow() === 0) {
    config.getRange(1, 1, 2, 2).setValues([["key", "value"], ["schema_version", "2"]]);
    config.setFrozenRows(1);
  } else {
    var rows = config.getRange(1, 1, config.getLastRow(), 2).getValues();
    var version = rows.find(function (row) { return row[0] === "schema_version"; });
    if (!version || String(version[1]) !== "2") throw new FikishaError("PLATFORM_SCHEMA_VERSION_MISMATCH");
  }

  return {
    spreadsheet_id: typeof spreadsheet.getId === "function" ? spreadsheet.getId() : "",
    schema_version: "2",
    sheets: Object.keys(FikishaPlatformSchema).concat(["PlatformConfig"])
  };
}
