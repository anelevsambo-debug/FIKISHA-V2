/**
 * Fail-closed Apps Script entrypoints.
 *
 * This project has no authenticated operational API or verified inbound webhook yet.
 * Do not deploy this placeholder as a live WhatsApp webhook.
 */
function doGet(e) {
  var payload = {
    service: "FIKISHA-V2",
    status: "not_configured",
    operationalApi: false,
    liveWhatsApp: false,
    code: "OPERATIONAL_API_NOT_CONFIGURED"
  };
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var payload = {
    ok: false,
    code: "WEBHOOK_NOT_CONFIGURED",
    operationalApi: false,
    liveWhatsApp: false
  };
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
