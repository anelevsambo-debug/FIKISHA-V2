function readFikishaConfig(getter) {
  if(typeof getter!=="function")throw new FikishaError("CONFIG_READER_REQUIRED");
  var get=function(k){var v=getter(k);return typeof v==="string"?v.trim():"";};
  var c={environment:get("FIKISHA_ENV"),platformWorkbookId:get("FIKISHA_PLATFORM_WORKBOOK_ID"),
    evidenceFolderId:get("FIKISHA_EVIDENCE_ROOT_FOLDER_ID"),whatsappMode:get("FIKISHA_WHATSAPP_MODE")||"DISABLED",
    whatsappToken:get("META_WHATSAPP_ACCESS_TOKEN"),whatsappPhoneNumberId:get("META_WHATSAPP_PHONE_NUMBER_ID"),
    whatsappVerifyToken:get("META_WHATSAPP_VERIFY_TOKEN")};
  if(!["development","staging","production"].includes(c.environment))throw new FikishaError("INVALID_ENVIRONMENT");
  if(!["DISABLED","META_CLOUD_API"].includes(c.whatsappMode))throw new FikishaError("INVALID_WHATSAPP_MODE");
  if(c.whatsappMode==="META_CLOUD_API"&&(!c.whatsappToken||!c.whatsappPhoneNumberId||!c.whatsappVerifyToken))throw new FikishaError("WHATSAPP_CONFIGURATION_INCOMPLETE");
  if(c.environment==="production"&&(!c.platformWorkbookId||!c.evidenceFolderId))throw new FikishaError("PRODUCTION_CONFIGURATION_INCOMPLETE");
  return Object.freeze(c);
}