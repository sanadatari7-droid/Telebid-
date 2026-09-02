############################################################################
# RDS Postgres, private subnets only, plus a single Secrets Manager secret
# holding the full DATABASE_URL DSN the app's pydantic Settings already
# expects (backend/app/core/config.py) — no backend code changes needed.
############################################################################

resource "random_password" "db" {
  length  = 32
  special = false # keep it URL-safe since it goes straight into a DSN string
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-db"
  subnet_ids = var.private_subnet_ids
  tags       = var.tags
}

resource "aws_db_instance" "this" {
  identifier     = "${var.name_prefix}-db"
  engine         = "postgres"
  engine_version = var.postgres_version

  instance_class        = var.instance_class
  allocated_storage     = var.allocated_storage_gb
  max_allocated_storage = var.max_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.security_group_id]
  publicly_accessible    = false

  multi_az                = var.multi_az
  backup_retention_period = var.backup_retention_days
  backup_window           = "03:00-04:00"
  maintenance_window      = "mon:04:30-mon:05:30"

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name_prefix}-db-final"

  tags = var.tags
}

# The DSN the app actually reads (config.py's DATABASE_URL) — composed here
# rather than relying on RDS's native manage_master_user_password feature,
# which would need a second secret + a data-source read to assemble one DSN
# string. This is simpler to review at the cost of the password living in
# Terraform state, which is standard practice given the state itself sits
# encrypted in the S3 backend (see bootstrap/).
resource "aws_secretsmanager_secret" "database_url" {
  name        = "${var.name_prefix}/database-url"
  description = "Full postgresql:// DSN for TeleBid's DATABASE_URL setting."
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgresql://${var.db_username}:${random_password.db.result}@${aws_db_instance.this.address}:5432/${var.db_name}"
}
