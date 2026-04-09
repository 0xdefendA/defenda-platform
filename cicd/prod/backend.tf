/*
  This file is intentionally inert for initial local Terraform runs.
  Rename to `backend.tf` and configure for Google Cloud Storage backend
  after the initial project setup to store Terraform state remotely.
*/
terraform {
  backend "gcs" {
    prefix = "cicd"
  }
}
