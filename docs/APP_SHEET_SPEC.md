# AppSheet application specification

This is a specification, not evidence that an AppSheet app has been created.

## Developer App
Use the platform administration workbook only. Proposed views: Companies, Onboarding Jobs, Integration Health, Audit Events and Configuration. Restrict access to named platform administrators. Do not connect this app to company delivery workbooks by default.

## Company Admin App
Use one company's workbook only. Proposed views: Delivery Dashboard, Deliveries, Assignment Offers, Drivers, Delivery Events, Proof of Delivery, Message Failures and Reports. Require authenticated sign-in. Do not allow direct editing of status, company ID, actor ID, version or audit fields. Sensitive transitions must go through backend validation.

## Driver interface
Use an authenticated interface with assignment-focused views. Drivers may submit action requests, but the backend must re-check membership and assignment before applying them.

## Required security setup
Use named-user access; keep company workbooks separate; do not use slices as the sole security boundary; restrict source workbook sharing; make event/audit tables read-only to ordinary users; test with separate accounts before launch.

No AppSheet app or live security filter has been created or verified. Current app-creation automation and licensing still need confirmation.
