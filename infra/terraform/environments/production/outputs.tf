output "cloudfront_domain_name" {
  description = "The app's public URL is https://<this>. After the first apply, set frontend_url/app_base_url/cors_origins in terraform.tfvars to this value and re-apply — see infra/README.md."
  value       = module.cdn.domain_name
}

output "cloudfront_distribution_id" {
  value = module.cdn.distribution_id
}

output "alb_dns_name" {
  value = module.ecs.alb_dns_name
}

output "ecr_repository_url" {
  description = "Needed by .github/workflows/deploy-backend.yml (as a repo variable/secret, or hardcode it there once known)."
  value       = module.cicd.ecr_repository_url
}

output "github_actions_role_arn" {
  description = "Needed by both GitHub Actions workflows' `role-to-assume` input."
  value       = module.cicd.github_actions_role_arn
}

output "frontend_bucket_name" {
  description = "Needed by .github/workflows/deploy-frontend.yml's `aws s3 sync` target."
  value       = module.storage.frontend_bucket_id
}

output "rds_endpoint" {
  value = module.database.endpoint
}

output "ecs_cluster_name" {
  value = module.ecs.cluster_name
}

output "ecs_service_name" {
  value = module.ecs.service_name
}
