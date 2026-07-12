---
name: hunt-control-plane-iam-abuse
phases: [persistence, privilege_escalation, credential_access]
cadence: "6 hours"
scope: environment
requires: [gcp_audit_activity]
enhanced_by: [gcp_data_access]
risk_weight_default: 50
provenance:
  authored_by: "agent reflection (gemini-3.1-pro-preview) over hunt_runs/seed-recall-02"
  authored_from_fixture: gcp-persistence-2026-07-11
  human_reviewed: pending
  eval:
    fixture: gcp-persistence-2026-07-11
    technique_recall: "5/5 (invite-external-user, create-admin-service-account, backdoor-service-account-policy, create-service-account-key, impersonate-service-accounts)"
    hallucinations: 0
    benign_false_positives: 0
  authoring_notes: |
    Written from what the run actually did, per the seed loop. TWO things were
    deliberately changed from the source transcript:
      1. STRIPPED the "service accounts named stratus-red-team" tell. The run led
         with it; it is a fixture artifact, not a detection method. A real
         adversary does not self-label. Encoding it would produce a skill that
         passes every eval and catches nothing in production.
      2. REPLACED the circular judgment in the run's second finding ("malicious
         because it is clustered with the confirmed stratus activity") with
         standalone behavioral criteria for impersonation and key creation, so the
         skill does not depend on another finding already being confirmed.
---

## Hypothesis

An identity is abusing the cloud control plane to establish persistence or
escalate privilege: granting roles to external principals, creating new
admin service accounts, minting long-lived service-account keys, or impersonating
service accounts. In a cloud-first org this IS the lateral movement — it is
identity movement, visible in the audit log without any endpoint telemetry.

The signal is not any single event (each has a benign twin) but a small set of
identities, new to the environment or acting off their own baseline, performing
these actions in a tight time cluster.

## Data (hunting-schema views)

* `identity_events` — the population sweep and per-identity deep dive.
* `iam_changes` — the control-plane workhorse. Small, complete result sets by
  construction. **Query `granted_members` / `granted_roles` (the arrays), never
  the scalar `granted_member`** — a single SetIamPolicy can carry several
  bindings, and the scalar is only the first, which may be the benign one.
* `feed_coverage` — orient here first; see Execution step 1.
* `first_seens` — novelty check (Execution step 4).

`iam_changes` and the IAM half of `identity_events` come from
`gcp_audit_activity` (always on). The impersonation signal
(`GenerateAccessToken`) is a `gcp_data_access` event — see the degradation note
under `requires`/`enhanced_by`.

## Execution steps (strategy — adapt the SQL, do not run it verbatim)

1. **Orient.** Count `identity_events` by `source` and `audit_log_type` over the
   window. Confirm the feeds you depend on are present before you trust any empty
   result. If `audit_log_type = 'data_access'` is absent, note that impersonation
   detection is blind for this run and say so in the report — do not read its
   silence as "no impersonation."
2. **Sweep.** Pull `identity_events` across the window, time-ordered, all
   projects. Do not scope to one project — the environment is the unit. Read the
   population: which identities are active, from which IPs, touching which
   projects. Most will be routine automation; you are looking for the few that
   are not.
3. **Go to the control plane.** Query `iam_changes` over the window. This is
   where external grants, admin-SA creation, and key creation land, and it is
   small enough to read in full. Flag:
   * a member in `granted_members` outside your org's domains and not a
     `*.iam.gserviceaccount.com` service account — an external grant;
   * `roles/owner`, `roles/editor`, or `roles/*serviceAccountTokenCreator` in
     `granted_roles`;
   * service-account **creation** followed by a role grant to that same new SA
     (the admin-SA pattern — the create and the grant are two events; link them);
   * `CreateServiceAccountKey` — a long-lived credential, the highest-value cloud
     persistence artifact.
4. **Pivot on the suspects.** Take the handful of identities implicated in step 3
   and deep-dive their full activity in the window from `identity_events`. Cross
   them against `first_seens` — an identity, source IP, or target project that is
   new this week raises confidence sharply. Look for `GenerateAccessToken`
   (impersonation) by these identities: a **new** actor minting a token for a
   service account it has no routine relationship with is credential abuse, even
   though platform automation mints tokens constantly.

## Correlation & judgment criteria (what rises to a signal)

Report a finding when the behavior clears a benign-baseline argument, not merely
because an event type occurred:

* **External grant** — role granted to a member outside org domains. High
  confidence on `roles/owner`/`roles/editor`; medium on narrower roles.
* **New admin identity** — a service account created and granted broad rights, or
  an identity absent from `first_seens` history suddenly making IAM changes.
* **Impersonation off-baseline** — `GenerateAccessToken` by an identity that does
  not routinely mint tokens, or targeting a service account outside its normal
  set. Platform automation impersonates constantly; the signal is a *new or
  unusual* actor/target pair, not the call itself.
* **Long-lived key creation** — `CreateServiceAccountKey`, especially on a
  service account that is not normally key-managed.
* **Correlation multiplies confidence** — several of the above by the same
  identity or same `source_ip` in a tight window is an attack chain, not
  coincidence. Report it as ONE correlated finding with the shared actor/IP,
  not as N disconnected alerts.

Do NOT rest a finding on the *name* of a service account or on another finding
already being confirmed. Judge each behavior on its own baseline.

Operator caveat: a human administrator legitimately doing IAM work looks a lot
like this. That ambiguity is real and expected — surface it, attribute the
actor and source IP, and let the human triager disposition it. Do not suppress
a real external-grant finding just because the actor might be an admin.

## Report shape

One correlated finding per attack chain (shared actor / source IP / time
cluster), each carrying:

* **Actor(s)** — the identities involved, and the `source_ip`.
* **What happened, in order** — the sequence (grant → create → key → impersonate),
  as a short narrative.
* **Evidence** — the real `eventid`s from `iam_changes` / `identity_events`.
  Cite representative events, not every row.
* **why_not_benign** — the baseline argument: why this is not routine automation
  or ordinary admin work. If you cannot make that argument convincingly, it is
  probably routine and does not belong in the report.

If the window is quiet, say so. `nothing_of_concern` is a correct and expected
verdict; a manufactured finding trains the humans reading you to stop reading.
