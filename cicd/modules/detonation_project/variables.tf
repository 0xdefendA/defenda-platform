variable "campaign_name" {
  description = <<-DESC
    Name of this detonation campaign. Changing it rolls a NEW random suffix,
    which means a new project and a new canary identity.

    That rotation is load-bearing, not cosmetic: first_seens is first-EVER, so a
    static canary in a static project stops being novel on the second run --
    novelty-driven hunts legitimately go quiet while the deadman screams that
    detection broke. Fresh identity per campaign keeps novelty honest.
  DESC
  type        = string
  default     = "seed"
}

variable "name_prefix" {
  description = <<-DESC
    Prefix for the generated project ID. GCP project IDs are globally unique
    across ALL of GCP -- not just your org -- so a fixed name eventually collides
    with a stranger's project. Final ID is "<name_prefix>-<8 hex chars>"
    (must stay within GCP's 6-30 char limit).
  DESC
  type        = string
  default     = "defenda-det"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,20}$", var.name_prefix))
    error_message = "name_prefix must start with a lowercase letter and be 3-21 chars of [a-z0-9-] (leaving room for the -<8 hex> suffix within GCP's 30-char project ID limit)."
  }
}

variable "detonation_project_id" {
  description = <<-DESC
    Explicit project ID, bypassing the random naming. Leave empty (recommended)
    to get an ephemeral "<name_prefix>-<random>" project. Set this only when
    pointing at a project you created by hand -- and pair it with
    create_project = false.
  DESC
  type        = string
  default     = ""
}

variable "create_project" {
  description = <<-DESC
    Create the sacrificial project from terraform.

    Defaults FALSE, deliberately. Project creation needs org-level
    resourcemanager.projectCreator plus billing.user -- org-scoped grants that the
    CI deployer should not hold. Same reasoning as the Data Access audit config
    (see defenda-collectas/SETUP.md): CI owns project-scoped resources; anything
    org-scoped is a human one-off.

    So: create the project by hand (one gcloud command, see
    docs/detonation_runbook.md), pass it as detonation_project_id, and let this
    module configure the canary inside it. Terraform still owns everything that
    lives WITHIN the project.

    Set true only when applying with your own org-admin credentials.
  DESC
  type        = bool
  default     = false
}

variable "organization_id" {
  description = <<-DESC
    Org to create the detonation project under. MUST be the same org collectA's
    org-level audit sink covers (include_children = true) -- that sink is what
    delivers Admin Activity logs from this project, and this module deliberately
    does not duplicate it.
  DESC
  type        = string
  default     = ""
}

variable "billing_account" {
  description = "Billing account for the detonation project. Detonations cost cents; leaving the project alive costs more."
  type        = string
  default     = ""
}

variable "platform_project_id" {
  description = "The defendA platform project ID (owns the defenda-event-ingest topic and the data lake)."
  type        = string
}

variable "ingest_topic_name" {
  description = "Name of the ingest Pub/Sub topic in the platform project."
  type        = string
  default     = "defenda-event-ingest"
}

variable "region" {
  description = "The GCP region for resources."
  type        = string
  default     = "us-central1"
}

variable "canary_account_id" {
  description = <<-DESC
    Base account ID of the canary identity that detonations run as; the campaign
    suffix is appended. Hunt skills must NEVER mention this identity -- the
    deadman assertion rule knows it, the agents do not. A skill that greps for
    the canary proves nothing when the canary fires.
  DESC
  type        = string
  default     = "hunta-canary"
}

variable "detonator_principals" {
  description = <<-DESC
    Principals allowed to impersonate the canary via ADC, e.g.
    ["user:jeff@example.com"]. Required to run stratus as the canary:

        gcloud auth application-default login --impersonate-service-account=<canary>

    NOT `gcloud config set auth/impersonate_service_account` -- that property is
    honored only by the gcloud CLI. Stratus authenticates through Application
    Default Credentials and ignores it, so detonations would land under YOUR
    identity, and every canary-filtered validation check would return zero rows.
  DESC
  type        = list(string)
  default     = []
}

# NOTE: there is deliberately no data_access_services variable here.
#
# Audit configuration is owned org-wide by collectA
# (defenda-collectas/terraform/gcp_audit_sink.tf, var.data_access_services).
# Enabling Data Access logs in THIS project alone would make the detonation
# environment richer than production, and any skill the hunt agent wrote from the
# resulting fixture would score perfectly on eval and detect nothing in prod.
#
# If you find yourself wanting to add telemetry here, add it at the org instead.
