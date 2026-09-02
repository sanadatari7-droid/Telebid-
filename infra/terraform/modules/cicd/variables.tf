variable "name_prefix" {
  type = string
}

variable "github_repo" {
  description = "owner/repo, e.g. \"sanadatari7-droid/Telebid-\". The IAM role's trust policy is scoped to this repo's main branch only."
  type        = string
}

variable "ecs_cluster_arn" {
  description = "Computed deterministically in environments/production/main.tf (arn:aws:ecs:<region>:<account>:cluster/<name>) rather than taken as a real module output — avoids a circular dependency, since the ecs module itself needs this module's ECR repo URL."
  type        = string
}

variable "ecs_service_arn" {
  type = string
}

variable "ecs_execution_role_arn" {
  description = "Also computed deterministically, same reasoning — IAM role ARNs are predictable from the role name the ecs module creates."
  type        = string
}

variable "ecs_task_role_arn" {
  type = string
}

variable "frontend_bucket_arn" {
  description = "Real output from the storage module — no cycle here, storage doesn't need anything back from this module."
  type        = string
}

variable "cloudfront_distribution_arn_pattern" {
  description = "Deterministically computed in environments/production/main.tf as arn:aws:cloudfront::<account>:distribution/* — CloudFront distribution IDs are only known after creation, and this module's ECR output is itself an input to the ecs module which the cdn module depends on, so taking the cdn module's real distribution ARN here would create a cicd->cdn->ecs->cicd cycle. Scoping to the account (there's only one distribution in this setup) instead of the exact ARN avoids it."
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
