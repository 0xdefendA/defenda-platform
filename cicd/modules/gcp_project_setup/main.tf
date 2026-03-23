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

resource "google_project_service" "secretmanager_api" {
  project            = var.project_id
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

data "google_project" "project" {
  project_id = var.project_id
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
    google_project_service.storage_api
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
      "name" : "severity",
      "type" : "STRING",
      "mode" : "NULLABLE"
    },
    {
      "name" : "summary",
      "type" : "STRING",
      "mode" : "NULLABLE"
    },
    {
      "name" : "category",
      "type" : "STRING",
      "mode" : "NULLABLE"
    },
    {
      "name" : "source",
      "type" : "STRING",
      "mode" : "NULLABLE"
    },
    {
      "name" : "tags",
      "type" : "STRING",
      "mode" : "REPEATED"
    },
    {
      "name" : "plugins",
      "type" : "STRING",
      "mode" : "REPEATED"
    },
    {
      "name" : "details",
      "type" : "JSON",
      "mode" : "NULLABLE"
    },
    {
      "name" : "eventid",
      "type" : "STRING",
      "mode" : "NULLABLE"
    }
  ])
  time_partitioning {
    type          = "DAY"
    field         = "utctimestamp"
    expiration_ms = 36720000000 # 425 days
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

resource "google_pubsub_topic" "defenda_alerta_evaluate" {
  project = var.project_id
  name    = "defenda-alerta-evaluate"
  depends_on = [
    google_project_service.pubsub_api
  ]
}

# IAM for Cloud Run services
resource "google_service_account" "ingesta_sa" {
  project      = var.project_id
  account_id   = "ingesta-sa"
  display_name = "ingestA Service Account"
  depends_on = [
    google_project_service.iam_api
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

resource "google_service_account" "responda_sa" {
  project      = var.project_id
  account_id   = "responda-sa"
  display_name = "respondA Service Account"
  depends_on = [
    google_project_service.iam_api
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

resource "google_project_iam_member" "alerta_bigquery_jobuser" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.alerta_sa.email}"
  depends_on = [
    google_service_account.alerta_sa
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

resource "google_project_iam_member" "responda_datastore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.responda_sa.email}"
  depends_on = [
    google_service_account.responda_sa,
    google_firestore_database.database
  ]
}

resource "google_project_iam_member" "alerta_pubsub_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.alerta_sa.email}"
  depends_on = [
    google_service_account.alerta_sa,
    google_pubsub_topic.defenda_alerta_evaluate
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
