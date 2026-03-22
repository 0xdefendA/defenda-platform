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

  project_id = var.project_id
  region     = var.region
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
resource "google_project_iam_member" "sa_roles" {
  for_each = toset([
    "roles/run.admin",
    "roles/iam.serviceAccountUser",
    "roles/storage.admin",
    "roles/logging.logWriter",
    "roles/cloudbuild.builds.editor",
    "roles/cloudbuild.builds.builder",
    "roles/resourcemanager.projectIamAdmin",
    "roles/secretmanager.admin",
    "roles/serviceusage.serviceUsageAdmin",
    "roles/developerconnect.readTokenAccessor",
    "roles/developerconnect.user",
    "roles/iam.serviceAccountAdmin",
    "roles/artifactregistry.admin",
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
  gar_repo_name  = "defenda-platform-repo"

  # generate a hash of the source files to use as image tag
  ingesta_hash       = sha1(join("", [for f in fileset(path.root, "../../services/ingestA/**") : filesha1(f)]))
  ingesta_image_name = "${local.location}-docker.pkg.dev/${local.project_id}/${local.gar_repo_name}/ingesta-service:${local.ingesta_hash}"
}

resource "terraform_data" "ingesta_build" {
  input = local.ingesta_image_name # the image name with tag

  triggers_replace = [
    local.ingesta_hash
  ]

  provisioner "local-exec" {
    command = <<EOT
        gcloud builds submit ../../services/ingestA \
          --config ../../services/ingestA/cloudbuild.yaml \
          --substitutions=_IMAGE=${self.input},_LOCATION=${local.location} \
          --service-account=${google_service_account.cloudbuild_sa.id} \
          --project=${local.project_id}
      EOT
    environment = {
      PROJECT_ID = local.project_id
    }
  }
  depends_on = [
    google_artifact_registry_repository.image-repo,
    google_storage_bucket.cloudbuild_artifacts,
    google_project_service.cloudbuild_api,
    google_project_iam_member.sa_roles
  ]
}

# --- Cloud Run Services ---

resource "google_cloud_run_v2_service" "ingestA_service" {
  project  = var.project_id
  name     = "ingesta-service"
  location = var.region

  template {
    service_account = module.gcp_project_setup.ingesta_sa_email
    containers {
      image = terraform_data.ingesta_build.output
      env {
        name  = "PROJECT_ID"
        value = var.project_id
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

resource "google_cloud_run_v2_service" "alertA_service" {
  project  = var.project_id
  name     = "alerta-service"
  location = var.region

  template {
    service_account = module.gcp_project_setup.alerta_sa_email
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

resource "google_cloud_run_v2_service" "respondA_service" {
  project  = var.project_id
  name     = "responda-service"
  location = var.region

  template {
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

# --- Cloud Run IAM ---

resource "google_cloud_run_v2_service_iam_member" "ingesta_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.ingestA_service.name
  role     = "roles/run.invoker"
  member   = "allUsers" # Allow unauthenticated invocation as per requirements
}

resource "google_cloud_run_v2_service_iam_member" "responda_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.respondA_service.name
  role     = "roles/run.invoker"
  member   = "allUsers" # Allow unauthenticated invocation as per requirements
}

# --- Triggers (Pub/Sub & Scheduler) ---

resource "google_pubsub_subscription" "defenda_event_ingest_sub" {
  project = var.project_id
  name    = "defenda-event-ingest-sub"
  topic   = module.gcp_project_setup.pubsub_topic_id

  ack_deadline_seconds = 10

  push_config {
    push_endpoint = google_cloud_run_v2_service.ingestA_service.uri
    oidc_token {
      service_account_email = module.gcp_project_setup.ingesta_sa_email
    }
  }
}

resource "google_cloud_scheduler_job" "trigger_alerta" {
  project  = var.project_id
  name     = "trigger-alerta"
  region   = var.region
  schedule = "* * * * *" # Every minute

  http_target {
    http_method = "GET"
    uri         = google_cloud_run_v2_service.alertA_service.uri
    oidc_token {
      service_account_email = module.gcp_project_setup.alerta_sa_email
    }
  }
}
