# Automation catalogue

| Workflow | Intended trigger | Current status |
|---|---|---|
| Validate delivery request | Authenticated create action | Partial service implemented |
| Append delivery event | Successful delivery operation | Service call exists; not transactionally guaranteed |
| Offer driver assignment | Dispatcher/system action | Transition table only; offer dispatch not implemented |
| Notify sender/recipient | Delivery event | Not implemented |
| Notify driver | Assignment offer | Not implemented |
| Process inbound WhatsApp | Provider webhook | Not implemented; doPost is placeholder |
| Process message statuses | Provider webhook | Not implemented |
| Retry failed notifications | Scheduled trigger | Not implemented |
| Stale assignment alert | Scheduled trigger | Not implemented |
| Daily company summary | Scheduled trigger | Not implemented |
| Company provisioning | Admin request | Partial Apps Script provisioning primitives; no live resources or end-to-end owner workflow verified |
| Workbook reconciliation | Scheduled trigger | Not implemented |
| Backup and restore | Scheduled trigger/manual exercise | Not implemented |

Do not install production triggers until each job has an idempotency strategy, bounded retries, audit logging and a tested failure path.
