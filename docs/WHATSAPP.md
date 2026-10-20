# WhatsApp integration status

Live WhatsApp is disabled. The mock provider supports isolated tests only. The web app doPost handler is a placeholder returning WEBHOOK_NOT_CONFIGURED and must not be used as a live Meta webhook.

The repository includes an outbound Meta Cloud API template adapter. It has not been configured with credentials and has not sent a real message. Inbound webhook processing, signature verification, status persistence, consent/opt-out enforcement and retry/dead-letter processing remain incomplete.

Tokens and webhook secrets belong in Apps Script Script Properties or an approved secret store, never in source or Sheets. Do not claim signature verification unless the documented provider scheme is implemented and tested. If the target runtime cannot validate the required signature, use a verifying relay and document its cost and operations.

Live-enable gates: sandbox round-trip; recorded opt-in; approved templates; authenticated inbound webhooks; duplicate/replay tests; retry/failure tests; written cost estimate; owner approval.