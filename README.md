# FIKISHA-V2 — Delivery Coordination

**Status: initial implementation package only. NOT deployed. NOT production-verified.** Core code and tests are incomplete; live Google adapters, AppSheet configuration, live WhatsApp, real concurrency, isolation, backups and legal checks remain pending.

Google Apps-first multi-company delivery coordination for KS Worldwide Stores & Logistics Limited, starting in Botswana (BWP). Each company gets a separate workbook, evidence folder and Company Admin app. The developer app uses the platform workbook only. See [Tenancy](docs/TENANCY.md) and [Go/No-Go](docs/GO_NO_GO.md).

The doPost handler is a placeholder returning WEBHOOK_NOT_CONFIGURED. Do not deploy it as a live Meta webhook. Mock WhatsApp is for simulation only.
