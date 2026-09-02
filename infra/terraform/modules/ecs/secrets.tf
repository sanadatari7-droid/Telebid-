############################################################################
# App secrets this module owns directly (DATABASE_URL is owned by the
# database module — see variables.tf's database_url_secret_arn input).
############################################################################

resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name = "${var.name_prefix}/jwt-secret-key"
  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = random_password.jwt_secret.result
}

resource "aws_secretsmanager_secret" "smtp_password" {
  name = "${var.name_prefix}/smtp-password"
  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "smtp_password" {
  secret_id     = aws_secretsmanager_secret.smtp_password.id
  secret_string = var.smtp_password
}

resource "aws_secretsmanager_secret" "anthropic_api_key" {
  name = "${var.name_prefix}/anthropic-api-key"
  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "anthropic_api_key" {
  secret_id     = aws_secretsmanager_secret.anthropic_api_key.id
  secret_string = var.anthropic_api_key
}
