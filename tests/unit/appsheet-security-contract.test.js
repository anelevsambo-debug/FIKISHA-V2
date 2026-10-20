const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadPermissions() {
  function FikishaError(code) {
    this.name = "FikishaError";
    this.code = code;
    this.message = code;
  }
  const context = { FikishaError };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "../../src/core/permissions.js"), "utf8");
  vm.runInContext(source, context, { filename: "src/core/permissions.js" });
  return context;
}

test("company action contract matches the four-interface role design", () => {
  const c = loadPermissions();
  const allow = (role, action) => c.roleCan(role, action);

  for (const action of ["VALIDATE_OK", "VALIDATE_FAIL", "OFFER_TO_DRIVER", "REOFFER", "OPEN_INCIDENT"]) {
    assert.equal(allow("DISPATCHER", action), true, "dispatcher should allow " + action);
  }
  for (const action of ["ACCEPT_OFFER", "DECLINE_OFFER", "CONFIRM_COLLECTION", "START_TRANSIT", "ATTEMPT_DELIVERY", "VERIFY_OTP", "FAIL_DELIVERY"]) {
    assert.equal(allow("DRIVER", action), true, "driver should allow " + action);
  }
  for (const action of ["VALIDATE_OK", "OFFER_TO_DRIVER", "CLOSE", "OPEN_INCIDENT", "OWNER_OVERRIDE"]) {
    assert.equal(allow("DRIVER", action), false, "driver must not allow " + action);
  }
  for (const action of ["ACCEPT_OFFER", "START_TRANSIT", "VERIFY_OTP"]) {
    assert.equal(allow("COMPANY_ADMIN", action), false, "company admin must not impersonate driver action " + action);
  }
  for (const action of ["PROVISION_COMPANY", "MANAGE_PLATFORM_ADMINS", "MANAGE_COMPANY_MEMBERS"]) {
    assert.equal(allow("COMPANY_ADMIN", action), false, "company role must not gain platform action " + action);
    assert.equal(allow("DISPATCHER", action), false, "dispatcher must not gain platform action " + action);
    assert.equal(allow("DRIVER", action), false, "driver must not gain platform action " + action);
  }
});

test("Company A and Company B actors cannot cross tenant boundaries", () => {
  const c = loadPermissions();
  const companyA = { actor_id: "company.a.dispatch.test", company_id: "COMPANY_A", role: "DISPATCHER", active: true };
  const companyB = { actor_id: "company.b.dispatch.test", company_id: "COMPANY_B", role: "DISPATCHER", active: true };

  assert.equal(c.assertTenantAccess(companyA, { company_id: "COMPANY_A" }), true);
  assert.equal(c.assertTenantAccess(companyB, { company_id: "COMPANY_B" }), true);
  assert.throws(() => c.assertTenantAccess(companyA, { company_id: "COMPANY_B" }), e => e && e.code === "TENANT_ACCESS_DENIED");
  assert.throws(() => c.assertTenantAccess(companyB, { company_id: "COMPANY_A" }), e => e && e.code === "TENANT_ACCESS_DENIED");
});

test("inactive, incomplete and developer actors fail closed for tenant operations", () => {
  const c = loadPermissions();
  const tenant = { company_id: "COMPANY_A" };
  assert.throws(() => c.assertTenantAccess(null, tenant), e => e && e.code === "TENANT_ACCESS_DENIED");
  assert.throws(() => c.assertTenantAccess({ actor_id: "missing-company", role: "DISPATCHER", active: true }, tenant), e => e && e.code === "TENANT_ACCESS_DENIED");
  assert.throws(() => c.assertTenantAccess({ actor_id: "inactive", company_id: "COMPANY_A", role: "DISPATCHER", active: false }, tenant), e => e && e.code === "ACTOR_INACTIVE");
  assert.throws(() => c.assertTenantAccess({ actor_id: "developer", company_id: "COMPANY_A", role: "DEVELOPER", active: true }, tenant), e => e && e.code === "DEVELOPER_DELIVERY_ACCESS_DENIED");
});

test("platform admin authority is not granted by company permission helpers", () => {
  const c = loadPermissions();
  for (const action of ["PROVISION_COMPANY", "MANAGE_PLATFORM_ADMINS", "MANAGE_COMPANY_MEMBERS", "ISSUE_QUOTE", "OFFER_TO_DRIVER"]) {
    assert.equal(c.roleCan("PLATFORM_ADMIN", action), false);
  }
  assert.equal(c.roleCan("COMPANY_ADMIN", "PROVISION_COMPANY"), false);
});

test("design document records source-level and AppSheet security gates", () => {
  const doc = fs.readFileSync(path.join(__dirname, "../../docs/APPSHEET_ROLE_SOURCE_SECURITY.md"), "utf8");
  for (const required of [
    "Require sign-in",
    "Security filters",
    "Company A workbook",
    "Company B workbook",
    "direct access",
    "slices",
    "NO-GO for live AppSheet operations",
    "not currently verified"
  ]) {
    assert.ok(doc.toLowerCase().includes(required.toLowerCase()), "design document must include: " + required);
  }
});
