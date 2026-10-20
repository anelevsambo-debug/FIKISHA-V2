function createMetaWhatsAppClient(config,httpClient,apiVersion) {
  if(!config||!config.accessToken||!config.phoneNumberId||typeof httpClient!=="function")throw new FikishaError("WHATSAPP_CONFIGURATION_INCOMPLETE");
  var version=apiVersion||"v23.0";
  if(!/^v\d+\.\d+$/.test(version))throw new FikishaError("INVALID_META_API_VERSION");
  function send(payload) {
    if(!payload||!isE164(payload.to)||!isNonEmptyString(payload.templateName)||!Array.isArray(payload.parameters))throw new FikishaError("INVALID_WHATSAPP_TEMPLATE_REQUEST");
    var body={messaging_product:"whatsapp",to:payload.to,type:"template",template:{name:payload.templateName,
      language:{code:payload.language||"en"},components:payload.parameters.length?[{type:"body",parameters:payload.parameters.map(function(p){return {type:"text",text:String(p)};})}]:[]}};
    var response;
    try{response=httpClient("https://graph.facebook.com/"+version+"/"+encodeURIComponent(config.phoneNumberId)+"/messages",
      {method:"post",contentType:"application/json",headers:{Authorization:"Bearer "+config.accessToken},payload:JSON.stringify(body),muteHttpExceptions:true});}
    catch(e){throw new FikishaError("WHATSAPP_NETWORK_ERROR");}
    var code=typeof response.getResponseCode==="function"?response.getResponseCode():response.status;
    var raw=typeof response.getContentText==="function"?response.getContentText():response.body,data;
    try{data=typeof raw==="string"?JSON.parse(raw):raw;}catch(e){data=null;}
    if(code<200||code>=300||!data||!data.messages||!data.messages[0]||!data.messages[0].id)throw new FikishaError("WHATSAPP_PROVIDER_REJECTED");
    return {provider:"META_CLOUD_API",provider_message_id:data.messages[0].id,status:"ACCEPTED_BY_PROVIDER"};
  }
  return Object.freeze({sendTemplate:send});
}