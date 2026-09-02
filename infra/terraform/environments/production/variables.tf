variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "name_prefix" {
  type    = string
  default = "telebid-production"
}

variable "azs" {
  description = "Must be exactly 2, in var.aws_region."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "github_repo" {
  description = "owner/repo for the GitHub Actions OIDC trust policy."
  type        = string
  default     = "sanadatari7-droid/Telebid-"
}

variable "frontend_bucket_name" {
  description = "Globally-unique. Change this before first apply — S3 bucket names are global across all AWS accounts."
  type        = string
  default     = "telebid-production-frontend"
}

variable "image_tag" {
  description = "Backend Docker image tag to deploy. The deploy-backend.yml workflow overrides this with the git commit SHA on every push; the default here only matters for a manual first apply before any image has been pushed."
  type        = string
  default     = "latest"
}

variable "desired_count" {
  type    = number
  default = 2
}

variable "db_multi_az" {
  type    = bool
  default = false
}

# ── App configuration passthrough — see modules/ecs/variables.tf for the
# full list and defaults; only the ones worth surfacing at this level are
# repeated here. Everything else can still be overridden via
# terraform.tfvars using the module's variable names if needed later.

variable "smtp_host" {
  type    = string
  default = ""
}

variable "smtp_user" {
  type    = string
  default = ""
}

variable "smtp_password" {
  type      = string
  sensitive = true
  default   = ""
}

variable "anthropic_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "frontend_url" {
  description = "Leave the default on the first apply; set to https://<cloudfront-domain> (from `terraform output cloudfront_domain_name`) and re-apply once known. See infra/README.md."
  type        = string
  default     = "https://REPLACE_AFTER_FIRST_APPLY_WITH_CLOUDFRONT_DOMAIN"
}

variable "app_base_url" {
  type    = string
  default = "https://REPLACE_AFTER_FIRST_APPLY_WITH_CLOUDFRONT_DOMAIN"
}

variable "cors_origins" {
  description = "JSON array string. Same two-phase-apply caveat as frontend_url."
  type        = string
  default     = "[\"https://REPLACE_AFTER_FIRST_APPLY_WITH_CLOUDFRONT_DOMAIN\"]"
}
