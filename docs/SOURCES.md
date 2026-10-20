# Sources to verify before deployment

Access date target: 20 October 2026. The build has not independently verified all claims against current official pages; recheck and record findings before relying on them.
- Apps Script quotas: https://developers.google.com/apps-script/guides/services/quotas
- Apps Script web apps: https://developers.google.com/apps-script/guides/web
- LockService: https://developers.google.com/apps-script/reference/lock/lock-service
- AppSheet security filters: https://support.google.com/appsheet/answer/10104488
- AppSheet pricing: https://about.appsheet.com/pricing/
- WhatsApp Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api/
- WhatsApp webhooks: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
- BOCRA: https://www.bocra.org.bw/

Webhook signature finding remains unverified. A secret URL is only a compensating control, not equivalent to Meta HMAC signature validation. If Apps Script cannot access required headers, use a signature-verifying relay and keep live webhook disabled until reviewed.
