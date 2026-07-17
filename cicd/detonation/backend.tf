/*
  Detonation campaign state -- SEPARATE from the platform state, on purpose.

  Same GCS bucket as cicd/prod, different prefix, therefore a different state
  file. That separation is load-bearing, not tidiness:

    * A detonation project is EPHEMERAL (create -> detonate -> export fixture ->
      destroy). If it lived in the platform's state, `terraform destroy` on a spent
      campaign would be a destroy against the state file that also holds the data
      lake, the Cloud Run services, and the alert policies. That is a foot aimed
      squarely at a shotgun.

    * cicd/prod is applied by CI. This root is applied by a HUMAN with org
      permissions (project creation is org-scoped -- see the privilege-tiering
      section of the huntA plan). If CI's deployer SA touched this state it would
      try to manage a project it has no rights in, and either fail the platform
      apply or drift.

    * Campaigns rotate. Blowing away this state and starting a fresh campaign
      should never be a decision that involves the platform.

  Init with the same bucket the platform uses:

    terraform init -backend-config="bucket=<TF_STATE_BUCKET>"
*/
terraform {
  backend "gcs" {
    prefix = "detonation"
  }
}
