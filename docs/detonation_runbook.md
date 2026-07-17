# Detonation Runbook (huntA phase 2a)

**Goal:** produce real attack telemetry in the production lake, prove the
hunting schema survives contact with it, and freeze the result as the first eval
fixture — *before* anyone writes a hunt skill.

**Why before:** the huntA plan's seed loop is explicit that skills are written
by an agent from completed work, never from human preconception. It is also
explicit that a hunt agent cannot find what ingest silently dropped. Today
`docs/hunting_schema.md` claims "this is where `invite-external-user` lands" —
that claim was written from design, not evidence. This runbook is the evidence.

---

## Prerequisites

### 1. A sacrificial project

Detonations do **not** run in the platform project. Stratus reverts cleanly in
the normal case, but a failed revert leaves an admin service account or an
external `roles/owner` grant behind — and the platform project is the one
running defendA. Blast radius is the whole point of the separation.

Telemetry from the sacrificial project flows through the **normal ingest path**
into the **production** lake. That is deliberate (huntA plan, seed loop): a
parallel dataset would validate nothing. Hunt agents are time-bounded and emit
signals at worst; BQ rows are deletable if pollution ever matters.

### 2. Create the sacrificial project (human, one-off)

Project creation needs org-scoped `resourcemanager.projectCreator` + `billing.user`
— grants the CI deployer should not hold, for the same reason it shouldn't hold
org `setIamPolicy` (see `defenda-collectas/SETUP.md`). **CI owns project-scoped
resources; anything org-scoped is a human one-off.** So make the project yourself:

```sh
export ORG_ID=<your org>           # must be the org collectA's sink covers
export BILLING=<billing account>
export DET_PROJECT="defenda-det-$(openssl rand -hex 4)"

gcloud projects create "$DET_PROJECT" --organization="$ORG_ID"
gcloud billing projects link "$DET_PROJECT" --billing-account="$BILLING"
```

The random suffix isn't just collision avoidance (GCP project IDs are globally
unique across all of GCP). It also keeps `first_seens` honest — see below.

### 3. Apply the terraform

Run from the **`cicd/detonation`** root — its own state, separate from the
platform (see `cicd/detonation/backend.tf` for why). Never from `cicd/prod`.

```sh
cd cicd/detonation
cp terraform.tfvars.example terraform.tfvars   # fill in project ids + your email

# same GCS bucket as the platform, different prefix -> different state file
terraform init -backend-config="bucket=<TF_STATE_BUCKET>"
terraform apply
```

Terraform owns everything *inside* the project: the canary service account, its
roles, and your ability to impersonate it. It creates **no sink and no audit
config** — collectA owns collection org-wide (see below).

The state lives in the `detonation/` prefix, isolated on purpose: a campaign is
ephemeral, so `terraform destroy` here tears down the canary without ever touching
platform state. Nothing about this is temporary in the "throwaway files" sense —
it is a real, versioned root; the *project it manages* is what is disposable.

#### Why the project name is random

GCP project IDs are globally unique across *all* of GCP, so a fixed
`defenda-detonation` eventually collides with a stranger's project. The
randomness also does real work for huntA: `first_seens` is first-**ever**, so a
static canary in a static project stops looking novel on the second detonation —
novelty-driven hunts legitimately go quiet while the deadman screams that
detection is broken. A fresh project and canary per campaign keeps novelty
honest. Detonation projects are meant to be **create → detonate → export →
destroy**.

#### This module creates no sink and no audit config — that's the point

Collection is owned **org-wide** by collectA
(`defenda-collectas/terraform/gcp_audit_sink.tf`): an aggregated sink with
`include_children = true`, plus an org-level Data Access audit config. It picks up
the detonation project automatically the moment the project exists under the org.

It would be easy to give the detonation project its own audit config instead —
enable Data Access just where we're attacking, keep the blast radius small. **That
would be the worst bug in the whole system.** The detonation project would be
*richer* than production: the hunt agent learns to hunt on `GenerateAccessToken`,
writes a skill keyed on it, and that skill scores perfectly against its eval
fixture forever — while detecting nothing in production, because no other project
emits those logs. A skill that passes evals and detects nothing is worse than no
skill; it makes the coverage map lie.

**The detonation environment must match the production telemetry surface, or the
seed loop encodes fiction.** So Data Access is on at the org, and the detonation
project is telemetrically identical to every other project — it just happens to
have an attacker in it.

**Prerequisites, both org-scoped and both human one-offs:**

1. The detonation project must live **under the org collectA's sink covers**.
   Otherwise it produces telemetry that never reaches the lake and the whole
   exercise silently measures nothing.
2. **Data Access logs must be enabled org-wide** before technique 5 produces
   anything:
   ```sh
   python scripts/enable_data_access_logs.py --org-id "$ORG_ID" --apply   # in defenda-collectas
   ```
   Verify before detonating — an unenabled feed and a quiet org look identical:
   ```sql
   SELECT * FROM `PROJECT.defenda_hunting.feed_coverage`
   WHERE audit_log_type = 'data_access';
   ```

> **The Data Access log types are counterintuitive.** `iam.googleapis.com` has no
> `DATA_READ` methods at all; `GenerateAccessToken` (impersonation) is
> **`ADMIN_READ`**; and `iamcredentials.googleapis.com` can't be configured
> independently — it rides on `iam.googleapis.com`. An intuitive
> `DATA_READ`-on-iamcredentials config applies cleanly, costs money, and captures
> nothing. See `scripts/enable_data_access_logs.py` before changing any log type.

> **On the canary identity.** Hunt skills must never mention it by name. The
> deadman assertion rule knows it; the agents do not. If a skill greps for the
> canary, a canary detection proves nothing.

### 3. Install stratus-red-team

```sh
# or: go install github.com/datadog/stratus-red-team/v2/cmd/stratus@latest
brew tap "datadog/stratus-red-team" "https://github.com/DataDog/stratus-red-team"
brew install datadog/stratus-red-team/stratus-red-team
```

---

## The detonation set

Chosen to cover **distinct audit-log shapes**, not distinct tactics. Five
persistence techniques would be a waste; these five each stress a different part
of the ingest → view path.

| # | technique | what it actually validates |
|---|---|---|
| 1 | `gcp.persistence.invite-external-user` | The happy path the plugin was written for (cloudresourcemanager `SetIamPolicy`, delta in `serviceData`). **If this fails, stop** — nothing else is worth debugging. |
| 2 | `gcp.persistence.create-service-account-key` | The non-`SetIamPolicy` branch of the `iam_changes` view filter. A long-lived SA key is the highest-value cloud persistence artifact there is. |
| 3 | `gcp.persistence.create-admin-service-account` | A **multi-event sequence** (create SA, then grant it a role). Two questions: do both events land, and can an agent link them? Also likely to produce a multi-binding `SetIamPolicy` — see Gap 1. |
| 4 | `gcp.persistence.backdoor-service-account-policy` | `SetIamPolicy` scoped to a **service account** (`iam.googleapis.com`), not a project. Confirms the delta-extraction path works for the non-project resource shape — see Gap 2 (downgraded from "predicted fail" to "expected pass, verify anyway"). |
| 5 | `gcp.privilege-escalation.impersonate-service-accounts` | A **Data Access** log (`GenerateAccessToken`, `ADMIN_READ` on `iam.googleapis.com`). Really a test of collectA's org-wide `audit_config`, not the plugin. If this is empty, credential-access hunting is blind org-wide no matter how good the agent is — check `feed_coverage` before blaming the agent. |
| 6 | Workspace: assign super-admin role *(hand-rolled)* | The `google_admin` plugin path, and — more importantly — whether Workspace and GCP identities **join on the same `identity` column**. That join is the entire premise of identity-centric hunting. |

### Predicted failures (write them down before running)

Calling the shot first is what separates a test from a demo. Both are already
encoded as `@unittest.expectedFailure` in
`services/ingestA/tests/test_plugin_gcp_audit.py`:

**Gap 1 — `bindingDeltas[0]` (certain).** `gcp_audit.py` reads only the first
binding delta. A real `SetIamPolicy` routinely carries several. If a benign
`roles/viewer` grant sorts to index 0, `iam_changes.granted_member` reports the
boring one and the interesting `roles/owner` grant vanishes. That is worse than
a miss — it is a confidently wrong answer.

**Gap 2 — `serviceData` shape (downgraded; likely a non-issue).** Originally
feared: the plugin reads the delta from
`protoPayload.serviceData.policyDelta.bindingDeltas`, and technique 4 targets
`iam.googleapis.com` rather than cloudresourcemanager, so the policy might appear
only in `request`/`response`. A fact-check against stratus's own published
detection sample for `backdoor-service-account-policy` showed the
`iam.googleapis.com` log **does** carry `serviceData.policyDelta.bindingDeltas`
— same shape as project-level events. So the existing extraction path should
work, and the unit test asserts it. Detonation still confirms against real
telemetry; if it comes back NULL, real GCP diverged from the documented sample —
capture the payload and fix the plugin. This is why you detonate instead of
trusting docs: even the fact-check gets verified by the real thing.

---

## Running it

Detonate **as the canary**, so every resulting event is attributable — that
attribution is the ground-truth label for the fixture.

```sh
# straight from terraform -- the project and canary names are randomized per campaign
export DETONATION_PROJECT=$(terraform output -raw detonation_project_id)
export CANARY=$(terraform output -raw canary_service_account_email)
export PLATFORM_PROJECT=<your platform project>
export GOOGLE_CLOUD_PROJECT=$DETONATION_PROJECT

# Impersonate the canary via ADC -- NOT `gcloud config set
# auth/impersonate_service_account`. That property is honored only by the gcloud
# CLI; stratus authenticates through Application Default Credentials (Go SDK) and
# ignores it, so detonations would land as YOUR user identity and every
# canary-filtered validation check would return zero rows. This form writes an
# impersonated-credentials ADC file the SDK actually respects:
#   (prereq: your user needs roles/iam.serviceAccountTokenCreator on the canary)
gcloud auth application-default login --impersonate-service-account=$CANARY

# note the window -- you need it for validation and export
export SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

export STRATUS_RED_TEAM_ATTACKER_EMAIL=<emailaddressofyourchoice>
stratus detonate gcp.persistence.invite-external-user
stratus detonate gcp.persistence.create-service-account-key
stratus detonate gcp.persistence.create-admin-service-account
stratus detonate gcp.persistence.backdoor-service-account-policy

# Impersonation -- hand-rolled, NOT stratus.
#
# The stratus technique gcp.privilege-escalation.impersonate-service-accounts has
# been unreliable (its terraform setup fails before detonation). The technique
# itself is trivial: mint an access token as another service account. That call is
# GenerateAccessToken on iamcredentials -- a DATA ACCESS log, and the whole reason
# we enabled Data Access org-wide. Do not let a broken wrapper leave the one
# credential-access technique untested.
#
# ATTRIBUTION IS THE WHOLE GAME HERE -- READ THIS.
#
# The attack we want to fixture is the CANARY AS ACTOR: canary mints a token for a
# victim SA. That is identity=canary, resource=victim.
#
# It is easy to get backwards. During the campaign you authenticated with
#   gcloud auth application-default login --impersonate-service-account=$CANARY
# which puts YOU at the top of every delegation chain -- so every getAccessToken
# under it attributes to your user, with the canary as the TARGET, not the actor.
# (In the seed run this produced ~76 mints attributed to the human operator. That
# is the reverse of the attack and does not belong in ground truth as the
# impersonation event.)
#
# A two-level chain (you -> canary -> victim) has AMBIGUOUS attribution -- GCP may
# credit the canary or may credit you-with-delegation-info. Do not rely on it.
#
# The unambiguous method: authenticate AS the canary via a key, removing yourself
# from the chain entirely. This is also the MORE REALISTIC attack -- an adversary
# who owned the canary would act with its credentials, not delegate through an
# admin's laptop.

# 1. a throwaway victim, and let the canary mint tokens for it
gcloud iam service-accounts create impersonation-victim \
  --project="$DETONATION_PROJECT" --display-name="huntA impersonation victim" || true
gcloud iam service-accounts add-iam-policy-binding \
  "impersonation-victim@${DETONATION_PROJECT}.iam.gserviceaccount.com" \
  --project="$DETONATION_PROJECT" \
  --member="serviceAccount:${CANARY}" \
  --role="roles/iam.serviceAccountTokenCreator"

# 2. become the canary DIRECTLY (a key -> no human in the chain). The key creation
#    is itself create-service-account-key telemetry; that is fine, we detonate that
#    too. Delete the key immediately after.
gcloud iam service-accounts keys create /tmp/canary-key.json \
  --iam-account="$CANARY" --project="$DETONATION_PROJECT"
gcloud auth activate-service-account --key-file=/tmp/canary-key.json

# 3. THE detonation: canary mints a token for the victim. identity=canary, unambiguous.
gcloud auth print-access-token \
  --impersonate-service-account="impersonation-victim@${DETONATION_PROJECT}.iam.gserviceaccount.com" \
  >/dev/null

# 4. revert and shred. activate-service-account only changed the active gcloud CLI
#    account (not ADC), so just re-select yourself; the campaign's ADC is untouched.
gcloud config set account YOUR_USER_EMAIL
shred -u /tmp/canary-key.json 2>/dev/null || rm -f /tmp/canary-key.json
# Delete the key server-side too, so it is not a lingering credential:
#   gcloud iam service-accounts keys list --iam-account="$CANARY"      # find KEY_ID
#   gcloud iam service-accounts keys delete KEY_ID --iam-account="$CANARY"

# Workspace atomic: grant a test account a super-admin role in the Admin console
# (Reports API surfaces it as an ASSIGN_ROLE admin activity). No stratus coverage;
# Workspace techniques have to be hand-rolled.

export UNTIL=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

> **When a technique's tooling breaks, do not just skip it.** Omitting it from the
> fixture export is correct — ground truth must describe what really happened, and a
> phantom technique surfaces later as a fake recall miss. But "never ran" and "ran,
> produced nothing" look identical in a fixture, and the second is a coverage gap
> that reports as green. Record the skip with `export_fixture.py --untested`, and
> try a hand-rolled atomic before accepting the gap. A technique you could not test
> is not a technique you can assume you would catch.

Give the sink and ingest a few minutes. Cloud Logging sink delivery is not
instant, and `utctimestamp` is the log's own time, not delivery time — so a
too-narrow window will look like a failed detonation.

### Verify the impersonation landed as canary-AS-ACTOR (do not assume)

Attribution here is subtle enough that it must be checked against data, not
asserted. Confirm the canary shows up as the **actor** (`identity`), with the
victim as the **target** (`resource`) — not merely as a target of your own login:

```sql
SELECT identity, action, resource, audit_log_type
FROM `PROJECT.defenda_hunting.identity_events`
WHERE utctimestamp >= TIMESTAMP('<the narrow window you just ran in>')
  AND LOWER(action) LIKE '%generateaccesstoken%'
  AND identity = '<canary email>'          -- the canary as ACTOR
ORDER BY utctimestamp;
```

One row with `identity=<canary>` and `resource=…impersonation-victim…` is success.
Zero rows means it still attributed to you (the key auth did not take, or a stale
ADC was in play) — fix that before exporting, or the fixture's ground truth for
this technique is a target-direction event masquerading as the attack.

### Clean up — every time, no exceptions

```sh
stratus cleanup --all
gcloud auth application-default revoke   # drop the impersonated ADC file
gcloud auth application-default login    # relogin as yourself
```

Then **verify by eye** in the console that no external grants or admin service
accounts survived. `stratus revert` failing silently is exactly how a sacrificial
project stops being sacrificial.

Once the fixture is exported (below), the strongest cleanup is:

```sh
cd cicd/detonation
terraform destroy               # removes the canary + IAM
gcloud projects delete "$DET_PROJECT"   # the project itself (created by hand, so removed by hand)
```

The project is ephemeral by design — one that outlives its campaign is just an
unmonitored project with an over-privileged service account in it. Because the
detonation state is isolated, this `destroy` cannot touch the platform.

> **Live external grant.** `backdoor-service-account-policy` grants
> `roles/iam.serviceAccountTokenCreator` to a **real external Google account**
> (`stratusredteam@gmail.com`) by default — a live external grant in the project
> and an external identity in the production lake until revert runs. Set
> `STRATUS_RED_TEAM_ATTACKER_EMAIL` to a benign address you control if you'd
> rather not, and treat the eyeball-check above as non-optional.

---

## Validate

```sh
uv run  tools/validate_detonation.py \
  --project $PLATFORM_PROJECT \
  --canary  $CANARY \
  --since   $SINCE
```

Prints a per-technique mapping report: did the event land, and is every field the
hunting schema promises actually populated. Each `FAIL` is a specific
plugin-or-view fix — not a mystery.

Read the failures as a hunt agent would: **a NULL column and a quiet environment
look identical.** Fix ingest first, re-detonate, and only then move on. A skill
written against a broken schema encodes the breakage.

---

## Freeze the fixture

```sh
python tools/export_fixture.py \
  --project    $PLATFORM_PROJECT \
  --canary     $CANARY \
  --since      $SINCE --until $UNTIL \
  --name       gcp-persistence-$(date -u +%Y-%m-%d) \
  --techniques gcp.persistence.invite-external-user,gcp.persistence.create-service-account-key,gcp.persistence.create-admin-service-account,gcp.persistence.backdoor-service-account-policy,gcp.privilege-escalation.impersonate-service-accounts
```

Writes `fixtures/<name>/` with `events.jsonl`, `ground_truth.json`, and
`manifest.json`. Commit it — fixtures are detections, code review applies.

The canary identity **is** the label: canary-attributed events are attack,
everything else in the window is background. That labeling is only sound because
detonations run as a dedicated identity, which is why the terraform creates one.

**Caveat the export prints, worth internalizing:** a sacrificial project has
almost no background traffic. This fixture measures **recall** honestly and
**precision** barely at all — a skill that alerts on everything would score
perfectly against it. Pair it with a benign busy-week fixture before trusting any
precision number.

---

Next steps (phase 2b onward — the ADK hunt harness, first SKILL.md, and the
deadman-detonation rollout) live in the plans, not here:
`plans/2026-07-06-huntA_skill_based_hunting-v1.md` and
`plans/2026-07-11-huntA_phase2b_adk_harness-v1.md`.
