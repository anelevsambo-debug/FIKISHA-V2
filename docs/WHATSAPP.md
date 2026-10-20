# WhatsApp integration status

Live WhatsApp is disabled. The mock provider supports simulation only. The web app doPost handler is a placeholder returning WEBHOOK_NOT_CONFIGURED and must not be used as a live Meta webhook.

Live-enable gates: (1) sandbox round-trip; (2) recorded opt-in; (3) approved templates; (4) retry/failure tests; (5) written cost estimate; (6) owner approval. Tokens and webhook secrets belong in Script Properties, never in source or Sheets. Apps Script header-access/HMAC limitations have not been conclusively verified here. Do not claim signature verification; use a signature-verifying relay if direct verification is unavailable.
