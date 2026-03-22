provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

module "gcp_project_setup" {
  source = "../modules/gcp_project_setup"

  project_id         = var.project_id
  region             = var.region
  ingesta_image_name = local.ingesta_image_name
}

resource "google_project_service" "cloudbuild_api" {
  project            = var.project_id
  service            = "cloudbuild.googleapis.com"
  disable_on_destroy = false
}

# Custom Service Account for Cloud Build to deploy infrastructure
resource "google_service_account" "cloudbuild_sa" {
  project      = var.project_id
  account_id   = "terraform-deployer"
  display_name = "Cloud Build Terraform Deployer"
  description  = "Account used by Cloud Build to deploy Cloud Run and Infrastructure"
}

# Grant permissions to the Service Account
# We iterate over a list of roles so we don\"t repeat code blocks.
resource "google_project_iam_member" "sa_roles" {
  for_each = toset([
    "roles/run.admin",                          # Deploy Cloud Run services
    "roles/iam.serviceAccountUser",             # Attach identities to Cloud Run services
    "roles/storage.admin",                      # Manage GCS buckets, Read/Write Terraform state files
    "roles/logging.logWriter",                  # Write build logs
    "roles/cloudbuild.builds.editor",           # Cloud Build Editor role
    "roles/cloudbuild.builds.builder",          # Cloud Build Builder role
    "roles/resourcemanager.projectIamAdmin",    # Modify IAM policies (if TF manages IAM)
    "roles/secretmanager.admin",                # Secret Manager
    "roles/serviceusage.serviceUsageAdmin",     # Enable Cloud Build SA to list and enable APIs in the project.
    "roles/developerconnect.readTokenAccessor", # enable terrafor to read tokens for cloudbuild triggers.
    "roles/developerconnect.user",              # enable terraform to reference repos
    "roles/iam.serviceAccountAdmin",            # manage service accounts
    "roles/artifactregistry.admin",             # create and manage artifact registry repos
  ])

  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.cloudbuild_sa.email}"

}


# create a bucket for cloudbuild artifacts
resource "google_storage_bucket" "cloudbuild_artifacts" {
  project                     = var.project_id
  name                        = "${var.project_id}-cloudbuild-artifacts"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true
  versioning {
    enabled = true
  }
}

resource "google_storage_bucket_iam_member" "cloudbuild_artifacts_iam" {
  bucket = google_storage_bucket.cloudbuild_artifacts.name
  role   = "roles/storage.admin"
  member = "serviceAccount:${google_service_account.cloudbuild_sa.email}"
}

resource "google_artifact_registry_repository" "image-repo" {
  provider = google-beta
  project  = var.project_id

  location      = var.region
  repository_id = "defenda-platform-repo"
  description   = "Docker repository for images used by Cloud Build"
  format        = "DOCKER"
}

resource "google_artifact_registry_repository_iam_member" "cloudbuild_artifact_registry_writer_iam" {
  provider = google-beta
  project  = var.project_id

  location   = google_artifact_registry_repository.image-repo.location
  repository = google_artifact_registry_repository.image-repo.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.cloudbuild_sa.email}"
  depends_on = [
    google_artifact_registry_repository.image-repo
  ]
}

locals {
  project_id     = var.project_id
  project_number = module.gcp_project_setup.project_number
  location       = var.region
  service_name   = "ingesta-service"
  cloudbuild_sa  = "serviceAccount:${google_service_account.cloudbuild_sa.email}"
  gar_repo_name  = "defenda-platform-repo"

  # generate a hash of the source files to use as image tag
  # this ensures new image is built only when source changes
  # and the cloud run service is updated accordingly
  ingesta_hash       = sha1(join("", [for f in fileset(path.root, "../../services/ingestA/**") : filesha1(f)]))
  ingesta_image_name = "${local.location}-docker.pkg.dev/${local.project_id}/${local.gar_repo_name}/ingesta-service:${local.ingesta_hash}"
}

resource "terraform_data" "ingesta_build" {
  input = local.ingesta_image_name # the image name with tag

  triggers_replace = [
    # Only triggers when actual code changes
    # use the hash as the image tag as well
    # to ensure cloud run gets updated image
    local.ingesta_hash
  ]

  provisioner "local-exec" {
    command = <<EOT
        gcloud builds submit ../../services/ingestA \
          --config ../../services/ingestA/cloudbuild.yaml \
          --substitutions=_IMAGE=${self.input} \
          --service-account=${google_service_account.cloudbuild_sa.id} \
          --project=${local.project_id}
      EOT
    environment = {
      PROJECT_ID = local.project_id
    }
  }
  depends_on = [
    google_artifact_registry_repository.image-repo,
    google_storage_bucket.cloudbuild_artifacts
  ]
}
