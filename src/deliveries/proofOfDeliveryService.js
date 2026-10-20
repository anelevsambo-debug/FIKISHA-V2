/**
 * Proof-of-delivery orchestration.
 * All security-sensitive integrations are injected; no request field is an identity source.
 * OTP plaintext exists only in memory long enough to send it and is never persisted/logged.
 */
function createProofOfDeliveryService(deps) {
  if (!deps || !deps.store || !deps.actorResolver || !deps.deliveryService ||
      typeof deps.clock !== "function" || typeof deps.idFactory !== "function" ||
      typeof deps.randomCode !== "function" || typeof deps.digestOtp !== "function" ||
      !deps.otpSender || typeof deps.otpSender.send !== "function" ||
      !deps.drive || typeof deps.drive.getDeliveryEvidenceFolder !== "function" ||
      typeof deps.drive.getFileMetadata !== "function" ||
      typeof deps.drive.assertRestrictedAccess !== "function") {
    throw new FikishaError("PROOF_SERVICE_DEPENDENCIES_REQUIRED");
  }
  var store = deps.store;
  var maxAttempts = Number(deps.maxAttempts || 5);
  var ttlMs = Number(deps.ttlMs || 5 * 60 * 1000);
  var allowedMimeTypes = ["image/jpeg", "image/png"];
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10 ||
      !Number.isFinite(ttlMs) || ttlMs < 60000 || ttlMs > 15 * 60 * 1000) {
    throw new FikishaError("PROOF_POLICY_INVALID");
  }
  ["createChallenge", "getChallenge", "listChallengesForDelivery", "updateChallenge",
   "registerProofEvidence", "getProofEvidence", "listProofEvidence", "createProofRecord",
   "getProofRecord", "invalidateChallenge"].forEach(function (name) {
    if (typeof store[name] !== "function") throw new FikishaError("PROOF_STORE_METHOD_REQUIRED", name);
  });

  function now() { var value = deps.clock(); return value instanceof Date ? value.getTime() : new Date(value).getTime(); }
  function iso(ms) { return new Date(ms).toISOString(); }
  function runExclusive(work) { return typeof store.runExclusive === "function" ? store.runExclusive(work) : work(); }
  function trusted(actor, companyId) {
    deps.actorResolver.assertTrusted(actor);
    if (!actor || actor.active !== true || actor.company_id !== companyId || actor.role === "DEVELOPER") {
      throw new FikishaError("TENANT_ACCESS_DENIED");
    }
  }
  function assignedDriver(actor, delivery) {
    trusted(actor, delivery.company_id);
    if (actor.role !== "DRIVER" || actor.actor_id !== delivery.driver_id) throw new FikishaError("ASSIGNED_DRIVER_REQUIRED");
  }
  function validId(value) { return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\\r\\n]/.test(value); }
  function constantTimeEqual(a, b) {
    a = String(a || ""); b = String(b || "");
    var difference = a.length ^ b.length, length = Math.max(a.length, b.length);
    for (var i = 0; i < length; i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return difference === 0;
  }
  function safeChallenge(challenge) {
    if (!challenge || !validId(challenge.challenge_id) || !validId(challenge.delivery_id) ||
        !validId(challenge.company_id) || !validId(challenge.issued_to_fingerprint) ||
        !Number.isFinite(new Date(challenge.expires_at).getTime()) ||
        !Number.isInteger(Number(challenge.attempt_count)) ||
        !Number.isInteger(Number(challenge.max_attempts)) || Number(challenge.max_attempts) < 1 ||
        Number(challenge.attempt_count) < 0 || Number(challenge.attempt_count) > Number(challenge.max_attempts)) {
      throw new FikishaError("PROOF_CHALLENGE_RECORD_INVALID");
    }
  }
  function fingerprintRecipient(delivery) {
    // Hash only a normalized recipient identifier; never copy the phone number into challenge rows.
    return deps.digestOtp("recipient|" + String(delivery.recipient_phone || "").replace(/[^+0-9]/g, ""));
  }
  function requireEvidence(evidenceIds, challenge, actor, delivery) {
    if (!Array.isArray(evidenceIds) || evidenceIds.length < 1 || evidenceIds.length > 5) {
      throw new FikishaError("PROOF_EVIDENCE_REQUIRED");
    }
    var unique = {};
    var records = [];
    evidenceIds.forEach(function (id) {
      if (!validId(id) || unique[id]) throw new FikishaError("PROOF_EVIDENCE_INVALID");
      unique[id] = true;
      var record = store.getProofEvidence(id);
      if (!record || record.company_id !== delivery.company_id || record.delivery_id !== delivery.delivery_id ||
          record.challenge_id !== challenge.challenge_id || record.verified !== true ||
          record.uploaded_by_actor_id !== actor.actor_id) throw new FikishaError("PROOF_EVIDENCE_BINDING_INVALID");
      records.push(record);
    });
    if (!records.some(function (r) { return r.evidence_type === "DELIVERY_PHOTO"; })) {
      throw new FikishaError("DELIVERY_PHOTO_REQUIRED");
    }
    if (records.some(function (r) { return allowedMimeTypes.indexOf(r.mime_type) < 0; })) {
      throw new FikishaError("PROOF_EVIDENCE_TYPE_INVALID");
    }
    return records;
  }
  function checkDriveEvidence(fileId, evidenceType, actor, delivery, challenge) {
    if (!validId(fileId) || ["DELIVERY_PHOTO", "RECIPIENT_SIGNATURE"].indexOf(evidenceType) < 0) {
      throw new FikishaError("PROOF_EVIDENCE_INPUT_INVALID");
    }
    var folderId = deps.drive.getDeliveryEvidenceFolder(delivery.company_id, delivery.delivery_id);
    if (!validId(folderId)) throw new FikishaError("DELIVERY_EVIDENCE_FOLDER_UNAVAILABLE");
    var metadata = deps.drive.getFileMetadata(fileId);
    if (!metadata || metadata.id !== fileId || metadata.trashed === true ||
        !allowedMimeTypes.includes(metadata.mime_type) ||
        !Array.isArray(metadata.parent_ids) || metadata.parent_ids.indexOf(folderId) < 0 ||
        metadata.parent_ids.length !== 1) throw new FikishaError("DRIVE_EVIDENCE_REFERENCE_INVALID");
    if (metadata.delivery_id !== delivery.delivery_id || metadata.company_id !== delivery.company_id) {
      throw new FikishaError("DRIVE_EVIDENCE_BINDING_INVALID");
    }
    deps.drive.assertRestrictedAccess(fileId, { company_id: delivery.company_id, delivery_id: delivery.delivery_id, allowed_roles: ["COMPANY_ADMIN", "DISPATCHER", "ASSIGNED_DRIVER"], allow_public: false, allow_link_sharing: false });
    return {
      evidence_id: deps.idFactory(), company_id: delivery.company_id, delivery_id: delivery.delivery_id,
      challenge_id: challenge.challenge_id, drive_file_id: fileId, evidence_type: evidenceType,
      mime_type: metadata.mime_type, parent_folder_id: folderId, uploaded_by_actor_id: actor.actor_id,
      verified: true, created_at: iso(now())
    };
  }

  function issueChallenge(args, actor) {
    return runExclusive(function () {
      if (!args || !validId(args.delivery_id)) throw new FikishaError("PROOF_REQUEST_INVALID");
      var delivery = deps.deliveryService.get(args.delivery_id, actor);
      assignedDriver(actor, delivery);
      if (delivery.status !== "DELIVERY_VERIFICATION_PENDING") throw new FikishaError("DELIVERY_NOT_READY_FOR_PROOF");
      var recipientFingerprint = fingerprintRecipient(delivery);
      if (!recipientFingerprint || !delivery.recipient_phone) throw new FikishaError("RECIPIENT_CONTACT_UNAVAILABLE");
      var time = now();
      store.listChallengesForDelivery(delivery.delivery_id).forEach(function (prior) {
        if (prior.status === "COMPLETING") throw new FikishaError("PROOF_COMPLETION_RECOVERY_REQUIRED");
        if (prior.status === "ACTIVE") store.invalidateChallenge(prior.challenge_id, "SUPERSEDED", iso(time));
      });
      var code = String(deps.randomCode());
      if (!/^\\d{6}$/.test(code)) throw new FikishaError("OTP_GENERATOR_INVALID");
      var challenge = {
        challenge_id: deps.idFactory(), company_id: delivery.company_id, delivery_id: delivery.delivery_id,
        issued_to_fingerprint: recipientFingerprint, issued_by_driver_id: actor.actor_id,
        otp_mac: deps.digestOtp("fikisha-pod-v1|" + delivery.company_id + "|" + delivery.delivery_id + "|" +
          recipientFingerprint + "|" + code),
        status: "ACTIVE", attempt_count: 0, max_attempts: maxAttempts,
        expires_at: iso(time + ttlMs), created_at: iso(time), consumed_at: "", invalidated_at: "",
        invalidation_reason: "", proof_id: "", completion_request_key: "", evidence_ids_json: ""
      };
      store.createChallenge(challenge);
      try {
        // The recipient phone is read from the persisted delivery, never supplied by the caller.
        deps.otpSender.send(delivery.recipient_phone, code, {
          company_id: delivery.company_id, delivery_id: delivery.delivery_id, challenge_id: challenge.challenge_id
        });
      } catch (error) {
        store.invalidateChallenge(challenge.challenge_id, "SEND_FAILED", iso(now()));
        throw new FikishaError("OTP_DELIVERY_FAILED");
      }
      return { challenge_id: challenge.challenge_id, expires_at: challenge.expires_at, attempts_remaining: maxAttempts };
    });
  }

  function registerEvidence(args, actor) {
    return runExclusive(function () {
      if (!args || !validId(args.challenge_id)) throw new FikishaError("PROOF_REQUEST_INVALID");
      var challenge = store.getChallenge(args.challenge_id);
      safeChallenge(challenge);
      var delivery = deps.deliveryService.get(challenge.delivery_id, actor);
      assignedDriver(actor, delivery);
      if (challenge.company_id !== delivery.company_id || challenge.status !== "ACTIVE" ||
          now() >= new Date(challenge.expires_at).getTime()) throw new FikishaError("PROOF_CHALLENGE_INVALID");
      var evidence = checkDriveEvidence(args.drive_file_id, args.evidence_type, actor, delivery, challenge);
      return store.registerProofEvidence(evidence);
    });
  }

  function completeDelivery(args, actor) {
    return runExclusive(function () {
      if (!args || !validId(args.challenge_id) || !validId(args.idempotency_key) ||
          args.idempotency_key.length > 128 || !Array.isArray(args.evidence_ids)) {
        throw new FikishaError("PROOF_REQUEST_INVALID");
      }
      var challenge = store.getChallenge(args.challenge_id);
      safeChallenge(challenge);
      var delivery = deps.deliveryService.get(challenge.delivery_id, actor);
      assignedDriver(actor, delivery);
      if (challenge.company_id !== delivery.company_id || challenge.delivery_id !== delivery.delivery_id ||
          challenge.issued_by_driver_id !== actor.actor_id) throw new FikishaError("PROOF_CHALLENGE_INVALID");
      var requestEvidenceJson = JSON.stringify(args.evidence_ids.slice().sort());
      if (challenge.status === "CONSUMED") {
        if (challenge.completion_request_key !== args.idempotency_key ||
            challenge.evidence_ids_json !== requestEvidenceJson || !challenge.proof_id) {
          throw new FikishaError("PROOF_CHALLENGE_ALREADY_USED");
        }
        return deps.deliveryService.transition({
          delivery_id: delivery.delivery_id, action: "VERIFY_OTP",
          idempotency_key: args.idempotency_key, proof_id: challenge.proof_id
        }, actor);
      }
      if (challenge.status === "COMPLETING") {
        if (challenge.completion_request_key !== args.idempotency_key ||
            challenge.evidence_ids_json !== requestEvidenceJson || !challenge.proof_id) {
          throw new FikishaError("PROOF_COMPLETION_IN_PROGRESS");
        }
        // Recover the interruption window after reserving completion but before proof-row persistence.
        if (!store.getProofRecord(challenge.proof_id)) {
          var recoveryEvidenceIds;
          try { recoveryEvidenceIds = JSON.parse(challenge.evidence_ids_json); }
          catch (error) { throw new FikishaError("PROOF_CHALLENGE_RECORD_INVALID"); }
          var recoveryEvidence = requireEvidence(recoveryEvidenceIds, challenge, actor, delivery);
          store.createProofRecord({
            proof_id: challenge.proof_id, delivery_id: delivery.delivery_id, company_id: delivery.company_id,
            verified: true, created_at: challenge.updated_at || challenge.created_at,
            challenge_id: challenge.challenge_id,
            evidence_ids_json: JSON.stringify(recoveryEvidence.map(function (e) { return e.evidence_id; })),
            verified_by_actor_id: actor.actor_id
          });
        }
        var recovered = deps.deliveryService.transition({
          delivery_id: delivery.delivery_id, action: "VERIFY_OTP",
          idempotency_key: args.idempotency_key, proof_id: challenge.proof_id
        }, actor);
        store.updateChallenge(Object.assign({}, challenge, { status: "CONSUMED", consumed_at: iso(now()) }), "COMPLETING");
        return recovered;
      }
      if (challenge.status !== "ACTIVE") throw new FikishaError("PROOF_CHALLENGE_INVALID");
      var time = now();
      if (time >= new Date(challenge.expires_at).getTime()) {
        store.invalidateChallenge(challenge.challenge_id, "EXPIRED", iso(time));
        throw new FikishaError("OTP_EXPIRED");
      }
      if (Number(challenge.attempt_count) >= Number(challenge.max_attempts)) {
        store.invalidateChallenge(challenge.challenge_id, "ATTEMPTS_EXHAUSTED", iso(time));
        throw new FikishaError("OTP_ATTEMPTS_EXHAUSTED");
      }
      if (!/^\\d{6}$/.test(String(args.otp || ""))) {
        challenge.attempt_count = Number(challenge.attempt_count) + 1;
        if (challenge.attempt_count >= challenge.max_attempts) store.invalidateChallenge(challenge.challenge_id, "ATTEMPTS_EXHAUSTED", iso(time));
        else store.updateChallenge(challenge, "ACTIVE");
        throw new FikishaError("OTP_INVALID");
      }
      var expectedMac = deps.digestOtp("fikisha-pod-v1|" + challenge.company_id + "|" + challenge.delivery_id + "|" +
        challenge.issued_to_fingerprint + "|" + String(args.otp));
      if (!constantTimeEqual(expectedMac, challenge.otp_mac)) {
        challenge.attempt_count = Number(challenge.attempt_count) + 1;
        if (challenge.attempt_count >= challenge.max_attempts) store.invalidateChallenge(challenge.challenge_id, "ATTEMPTS_EXHAUSTED", iso(time));
        else store.updateChallenge(challenge, "ACTIVE");
        throw new FikishaError("OTP_INVALID");
      }
      if (fingerprintRecipient(delivery) !== challenge.issued_to_fingerprint) {
        store.invalidateChallenge(challenge.challenge_id, "RECIPIENT_CHANGED", iso(time));
        throw new FikishaError("RECIPIENT_BINDING_CHANGED");
      }
      var evidence = requireEvidence(args.evidence_ids, challenge, actor, delivery);
      var proofId = deps.idFactory();
      var nextChallenge = Object.assign({}, challenge, {
        status: "COMPLETING", proof_id: proofId, completion_request_key: args.idempotency_key,
        evidence_ids_json: requestEvidenceJson, updated_at: iso(time)
      });
      store.updateChallenge(nextChallenge, "ACTIVE");
      store.createProofRecord({
        proof_id: proofId, delivery_id: delivery.delivery_id, company_id: delivery.company_id,
        verified: true, created_at: iso(time), challenge_id: challenge.challenge_id,
        evidence_ids_json: JSON.stringify(evidence.map(function (e) { return e.evidence_id; })),
        verified_by_actor_id: actor.actor_id
      });
      var result = deps.deliveryService.transition({
        delivery_id: delivery.delivery_id, action: "VERIFY_OTP",
        idempotency_key: args.idempotency_key, proof_id: proofId
      }, actor);
      store.updateChallenge(Object.assign({}, nextChallenge, { status: "CONSUMED", consumed_at: iso(now()) }), "COMPLETING");
      return result;
    });
  }

  return Object.freeze({ issueChallenge: issueChallenge, registerEvidence: registerEvidence, completeDelivery: completeDelivery });
}
