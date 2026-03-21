module "gcp_project_setup" {
  source = "../modules/gcp_project_setup"

  project_id = var.project_id
  region     = var.region
}
