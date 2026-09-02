output "ecr_repository_url" {
  value = aws_ecr_repository.backend.repository_url
}

output "github_actions_role_arn" {
  description = "Not needed as a Terraform reference elsewhere, but this is the value the deploy workflows' `role-to-assume` input needs — see infra/README.md."
  value       = aws_iam_role.github_actions.arn
}
