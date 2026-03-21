resource "google_project_service" "compute_api" {
  project            = var.project_id
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "run_api" {
  project            = var.project_id
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "bigquery_api" {
  project            = var.project_id
  service            = "bigquery.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "firestore_api" {
  project            = var.project_id
  service            = "firestore.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "pubsub_api" {
  project            = var.project_id
  service            = "pubsub.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "cloudscheduler_api" {
  project            = var.project_id
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "storage_api" {
  project            = var.project_id
  service            = "storage.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "iam_api" {
  project            = var.project_id
  service            = "iam.googleapis.com"
  disable_on_destroy = false
}

resource "google_storage_bucket" "terraform_state" {
  project                     = var.project_id
  name                        = "${var.project_id}-tf-state"
  location                    = var.region
  force_destroy               = false # Set to true to allow deletion of non-empty bucket
  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }


  depends_on = [
    google_project_service.storage_api # assuming storage_api is added
  ]
}

# BigQuery Dataset and Table
resource "google_bigquery_dataset" "defenda_data_lake" {
  dataset_id = "defenda_data_lake"
  project    = var.project_id
  location   = var.region
}

resource "google_bigquery_table" "events" {
  dataset_id = google_bigquery_dataset.defenda_data_lake.dataset_id
  table_id   = "events"
  project    = var.project_id
  schema = jsonencode([
    {
      "name" : "utctimestamp",
      "type" : "TIMESTAMP",
      "mode" : "REQUIRED"
    },
    {
      "name" : "details",
      "type" : "JSON",
      "mode" : "NULLABLE"
    }
  ])
  time_partitioning {
    type  = "DAY"
    field = "utctimestamp"
  }
  depends_on = [
    google_project_service.bigquery_api
  ]
}

# Firestore Database
resource "google_firestore_database" "database" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
  depends_on = [
    google_project_service.firestore_api
  ]
}

# Pub/Sub Topic
resource "google_pubsub_topic" "defenda_event_ingest" {
  project = var.project_id
  name    = "defenda-event-ingest"
  depends_on = [
    google_project_service.pubsub_api
  ]
}

# Cloud Run Services (Placeholders)
resource "google_cloud_run_v2_service" "ingestA_service" {
  project  = var.project_id
  name     = "ingesta-service"
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
  depends_on = [
    google_project_service.run_api
  ]
}

resource "google_cloud_run_v2_service" "alertA_service" {
  project  = var.project_id
  name     = "alerta-service"
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
  depends_on = [
    google_project_service.run_api
  ]
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
  depends_on = [
    google_project_service.run_api
  ]
}

# IAM for Cloud Run services
resource "google_service_account" "ingesta_sa" {
  project      = var.project_id
  account_id   = "ingesta-sa"
  display_name = "ingestA Service Account"
  depends_on = [
    google_project_service.iam_api # implicitly enabled by other services
  ]
}

resource "google_service_account" "alerta_sa" {
  project      = var.project_id
  account_id   = "alerta-sa"
  display_name = "alertA Service Account"
  depends_on = [
    google_project_service.iam_api
  ]
}

resource "google_cloud_run_v2_service_iam_member" "ingesta_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.ingestA_service.name
  role     = "roles/run.invoker"
  member   = "allUsers" # Allow unauthenticated invocation as per requirements
  depends_on = [
    google_cloud_run_v2_service.ingestA_service
  ]
}

resource "google_cloud_run_v2_service_iam_member" "responda_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.respondA_service.name
  role     = "roles/run.invoker"
  member   = "allUsers" # Allow unauthenticated invocation as per requirements
  depends_on = [
    google_cloud_run_v2_service.respondA_service
  ]
}

# IAM for BigQuery and Firestore
resource "google_project_iam_member" "ingesta_bigquery_dataeditor" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.ingesta_sa.email}"
  depends_on = [
    google_service_account.ingesta_sa,
    google_bigquery_dataset.defenda_data_lake
  ]
}

resource "google_project_iam_member" "alerta_bigquery_dataviewer" {
  project = var.project_id
  role    = "roles/bigquery.dataViewer"
  member  = "serviceAccount:${google_service_account.alerta_sa.email}"
  depends_on = [
    google_service_account.alerta_sa,
    google_bigquery_dataset.defenda_data_lake
  ]
}

resource "google_project_iam_member" "alerta_datastore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.alerta_sa.email}"
  depends_on = [
    google_service_account.alerta_sa,
    google_firestore_database.database
  ]
}

# Pub/Sub Push Subscription
resource "google_pubsub_subscription" "defenda_event_ingest_sub" {
  project = var.project_id
  name    = "defenda-event-ingest-sub"
  topic   = google_pubsub_topic.defenda_event_ingest.name

  ack_deadline_seconds = 10

  push_config {
    push_endpoint = google_cloud_run_v2_service.ingestA_service.uri
    oidc_token {
      service_account_email = google_service_account.ingesta_sa.email
    }
  }
  depends_on = [
    google_pubsub_topic.defenda_event_ingest,
    google_cloud_run_v2_service.ingestA_service,
    google_service_account.ingesta_sa
  ]
}

# Cloud Scheduler Job
resource "google_cloud_scheduler_job" "trigger_alerta" {
  project  = var.project_id
  name     = "trigger-alerta"
  region   = var.region
  schedule = "* * * * *" # Every minute

  http_target {
    http_method = "GET"
    uri         = google_cloud_run_v2_service.alertA_service.uri
    oidc_token {
      service_account_email = google_service_account.alerta_sa.email
    }
  }
  depends_on = [
    google_cloud_run_v2_service.alertA_service,
    google_service_account.alerta_sa,
    google_project_service.cloudscheduler_api
  ]
}

# Provider configuration for Google (and beta for firestore until it's GA)
terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

