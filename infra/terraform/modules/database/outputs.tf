output "endpoint" {
  value = aws_db_instance.this.address
}

output "database_url_secret_arn" {
  description = "Pass this to the ECS module's secrets block for the DATABASE_URL env var."
  value       = aws_secretsmanager_secret.database_url.arn
}
