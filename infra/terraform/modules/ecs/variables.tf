variable "name_prefix" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "alb_security_group_id" {
  type = string
}

variable "ecs_tasks_security_group_id" {
  type = string
}

variable "ecr_repository_url" {
  description = "From the cicd module."
  type        = string
}

variable "image_tag" {
  description = "Docker image tag to deploy — the deploy workflow passes the git commit SHA (-var image_tag=$GITHUB_SHA)."
  type        = string
  default     = "latest"
}

variable "database_url_secret_arn" {
  description = "From the database module."
  type        = string
}

variable "efs_file_system_id" {
  type = string
}

variable "efs_access_point_id" {
  type = string
}

variable "cloudfront_origin_secret" {
  description = "Shared secret the ALB listener requires as an X-Origin-Verify header, rejecting any request that didn't come through CloudFront. Generated once in environments/production/main.tf and passed to both this module and the cdn module."
  type        = string
  sensitive   = true
}

variable "task_cpu" {
  type    = string
  default = "512"
}

variable "task_memory" {
  type    = string
  default = "1024"
}

variable "desired_count" {
  description = "Number of running tasks. >=2 for zero-downtime rolling deploys."
  type        = number
  default     = 2
}

variable "log_retention_days" {
  type    = number
  default = 30
}

# ── App configuration (mirrors backend/app/core/config.py's Settings) ──────
# Secret-worthy values (SMTP password, Anthropic key, JWT signing key) are
# handled as dedicated Secrets Manager secrets in secrets.tf, not here.

variable "jwt_algorithm" {
  type    = string
  default = "HS256"
}

variable "jwt_access_token_expire_minutes" {
  type    = number
  default = 60
}

variable "jwt_refresh_token_expire_days" {
  type    = number
  default = 7
}

variable "smtp_host" {
  type    = string
  default = ""
}

variable "smtp_port" {
  type    = number
  default = 587
}

variable "smtp_user" {
  type    = string
  default = ""
}

variable "smtp_from" {
  type    = string
  default = "TeleBid Enterprise <noreply@telebid.com>"
}

variable "smtp_tls" {
  type    = bool
  default = true
}

variable "app_base_url" {
  description = "Used to build links in outgoing emails. The CloudFront domain isn't known until after the CDN module's first apply (its own domain name can't be a Terraform input to this module without a circular module dependency) — leave the default on the first apply, then set this to https://<cloudfront-domain> in terraform.tfvars and re-apply. See infra/README.md."
  type        = string
  default     = "https://REPLACE_AFTER_FIRST_APPLY_WITH_CLOUDFRONT_DOMAIN"
}

variable "frontend_url" {
  description = "Same caveat as app_base_url."
  type        = string
  default     = "https://REPLACE_AFTER_FIRST_APPLY_WITH_CLOUDFRONT_DOMAIN"
}

variable "max_file_size_mb" {
  type    = number
  default = 25
}

variable "max_failed_logins" {
  type    = number
  default = 5
}

variable "bcrypt_rounds" {
  type    = number
  default = 12
}

variable "cors_origins" {
  description = "JSON array string — pydantic-settings v2 JSON-decodes List[str] env vars. Same caveat as app_base_url re: the CloudFront domain."
  type        = string
  default     = "[\"https://REPLACE_AFTER_FIRST_APPLY_WITH_CLOUDFRONT_DOMAIN\"]"
}

variable "anthropic_model" {
  type    = string
  default = "claude-opus-5"
}

variable "smtp_password" {
  description = "Real value should come from terraform.tfvars (gitignored) or be set directly in Secrets Manager after apply via `aws secretsmanager put-secret-value` — see infra/README.md. Left blank, the app runs in its existing 'demo mode' (OTP codes shown in the API response instead of emailed)."
  type        = string
  sensitive   = true
  default     = ""
}

variable "anthropic_api_key" {
  description = "Same as smtp_password — blank disables the AI Bid/No-Bid Advisor feature gracefully rather than breaking deploy."
  type        = string
  sensitive   = true
  default     = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}
