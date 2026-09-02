output "state_bucket_name" {
  description = "Copy this into environments/production/backend.tf's `bucket` field."
  value       = aws_s3_bucket.terraform_state.id
}

output "lock_table_name" {
  description = "Copy this into environments/production/backend.tf's `dynamodb_table` field."
  value       = aws_dynamodb_table.terraform_lock.name
}

output "aws_region" {
  description = "Copy this into environments/production/backend.tf's `region` field."
  value       = var.aws_region
}
