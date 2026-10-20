# Sources and verification register

This register points to official documentation. The presence of a link is not proof that the current implementation complies with the latest requirements. Verify and record the exact page/version on the date of deployment.

- Apps Script overview: https://developers.google.com/apps-script
- Apps Script quotas: https://developers.google.com/apps-script/guides/services/quotas
- Apps Script web apps: https://developers.google.com/apps-script/guides/web
- Apps Script LockService: https://developers.google.com/apps-script/reference/lock/lock-service
- AppSheet security filters: https://support.google.com/appsheet/answer/10104488
- AppSheet documentation: https://support.google.com/appsheet
- AppSheet pricing: https://about.appsheet.com/pricing/
- Meta WhatsApp Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api/
- Meta WhatsApp webhooks: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
- Meta WhatsApp pricing: https://developers.facebook.com/docs/whatsapp/pricing/
- GitHub Actions: https://docs.github.com/actions
- BOCRA: https://www.bocra.org.bw/

## Outstanding verification
Current AppSheet app-creation API availability, exact supported Meta API version, regional/provider availability, webhook signature requirements for the selected endpoint, current prices and Botswana/Eswatini legal obligations have not yet been independently verified for this build. The webhook signature finding remains unverified. A secret URL is not equivalent to Meta signature validation. If Apps Script cannot validate the provider's required signature, use a verifying relay and keep the live webhook disabled until reviewed.
