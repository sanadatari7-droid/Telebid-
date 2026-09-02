output "domain_name" {
  description = "The app's public URL is https://<this>. Feed it back into terraform.tfvars' frontend_url/app_base_url/cors_origins after the first apply — see infra/README.md."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "distribution_id" {
  description = "Used by deploy-frontend.yml for cache invalidation."
  value       = aws_cloudfront_distribution.this.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.this.arn
}
