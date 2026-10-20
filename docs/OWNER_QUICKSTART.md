# Owner Quickstart — not yet ready for deployment

1. Open the build pull request on GitHub and review changed files.
2. Wait for GitHub Actions and inspect actual test counts and failures.
3. Ask a trusted technical helper to complete missing modules, Google adapters and security tests before creating live workbooks.
4. Use synthetic data only until the helper confirms the package is ready for a simulated run.
5. Never deploy the current doPost handler; it intentionally returns WEBHOOK_NOT_CONFIGURED.
6. Configure AppSheet only after separate company workbooks, read-only Deliveries, add-only ActionRequests, sign-in and role filters are reviewed.
7. Complete all GO/NO-GO gates before real customer data or a live operator.

If UB computer policy blocks Google authorisation or Apps Script, do not bypass policy; use an authorised trusted helper.
