/**
 * Trusted actor resolver for internal server-side application paths.
 *
 * IMPORTANT: getAuthenticatedEmail must be composed from a trusted authentication
 * boundary. It must not simply read an email/actor field from an untrusted request.
 * No public Apps Script endpoint is enabled in this project yet.
 */
function createTrustedActorResolver(deps) {
  if (!deps ||
      typeof deps.getAuthenticatedEmail !== "function" ||
      !deps.membershipStore ||
      typeof deps.membershipStore.getMembershipByEmail !== "function") {
    throw new FikishaError("ACTOR_RESOLVER_DEPENDENCIES_REQUIRED");
  }

  var trustedActors = new WeakSet();
  var allowedRoles = ["COMPANY_ADMIN", "DISPATCHER", "DRIVER"];

  function normalizeEmail(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  function trustedEmail(invocationContext) {
    var value;
    try {
      value = deps.getAuthenticatedEmail(invocationContext);
    } catch (error) {
      throw new FikishaError(error && error.code ? error.code : "IDENTITY_PROVIDER_FAILURE");
    }
    var email = normalizeEmail(value);
    if (!email) throw new FikishaError("AUTHENTICATED_IDENTITY_REQUIRED");
    return email;
  }

  function registryRead(work) {
    try {
      return work();
    } catch (error) {
      throw new FikishaError(error && error.code ? error.code : "IDENTITY_REGISTRY_UNAVAILABLE");
    }
  }

  function resolve(invocationContext, requestedCompanyId) {
    var email = trustedEmail(invocationContext);
    if (typeof requestedCompanyId !== "string" || !requestedCompanyId.trim()) {
      throw new FikishaError("COMPANY_CONTEXT_REQUIRED");
    }

    var companyId = requestedCompanyId.trim();
    var membership = registryRead(function () {
      return deps.membershipStore.getMembershipByEmail(email, companyId);
    });
    if (!membership) throw new FikishaError("MEMBERSHIP_NOT_FOUND");
    if (normalizeEmail(membership.email) !== email || membership.company_id !== companyId) {
      throw new FikishaError("TENANT_ACCESS_DENIED");
    }
    if (membership.active !== true) throw new FikishaError("ACTOR_INACTIVE");
    if (typeof membership.actor_id !== "string" || !membership.actor_id.trim()) {
      throw new FikishaError("MEMBERSHIP_RECORD_INVALID");
    }
    if (allowedRoles.indexOf(membership.role) === -1) throw new FikishaError("ACTOR_ROLE_INVALID");

    var actor = Object.freeze({
      actor_id: membership.actor_id,
      email: email,
      company_id: companyId,
      role: membership.role,
      active: true
    });
    trustedActors.add(actor);
    return actor;
  }

  function resolvePlatformAdmin(invocationContext) {
    if (typeof deps.membershipStore.getPlatformAdminByEmail !== "function") throw new FikishaError("PLATFORM_ADMIN_STORE_REQUIRED");
    var email = trustedEmail(invocationContext);
    var admin = registryRead(function () {
      return deps.membershipStore.getPlatformAdminByEmail(email);
    });
    if (!admin || normalizeEmail(admin.email) !== email) throw new FikishaError("PLATFORM_ADMIN_REQUIRED");
    if (admin.active !== true) throw new FikishaError("ACTOR_INACTIVE");
    if (typeof admin.actor_id !== "string" || !admin.actor_id.trim()) throw new FikishaError("PLATFORM_ADMIN_RECORD_INVALID");
    var actor = Object.freeze({ actor_id: admin.actor_id, email: email, role: "DEVELOPER", active: true, platform_admin: true });
    trustedActors.add(actor);
    return actor;
  }

  function resolveSystemActor(invocationContext, companyId) {
    if (typeof deps.getAuthenticatedSystemPrincipal !== "function") {
      throw new FikishaError("SYSTEM_IDENTITY_PROVIDER_REQUIRED");
    }
    if (typeof companyId !== "string" || !companyId.trim()) throw new FikishaError("COMPANY_CONTEXT_REQUIRED");
    var principal;
    try { principal = deps.getAuthenticatedSystemPrincipal(invocationContext); }
    catch (error) { throw new FikishaError(error && error.code ? error.code : "SYSTEM_IDENTITY_PROVIDER_FAILURE"); }
    if (typeof principal !== "string" || !principal.trim()) throw new FikishaError("SYSTEM_IDENTITY_REQUIRED");
    var actor = Object.freeze({
      actor_id: "SYSTEM:" + principal.trim(),
      email: "",
      company_id: companyId.trim(),
      role: "SYSTEM",
      active: true
    });
    trustedActors.add(actor);
    return actor;
  }

  function assertTrusted(actor) {
    if (!actor || (typeof actor !== "object") || !trustedActors.has(actor)) {
      throw new FikishaError("UNTRUSTED_ACTOR_CONTEXT");
    }
    return actor;
  }

  return Object.freeze({
    resolve: resolve,
    resolveSystemActor: resolveSystemActor,
    resolvePlatformAdmin: resolvePlatformAdmin,
    isTrusted: function (actor) {
      return !!actor && typeof actor === "object" && trustedActors.has(actor);
    },
    assertTrusted: assertTrusted
  });
}
