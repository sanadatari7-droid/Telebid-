############################################################################
# EFS: shared, durable storage for the backend's local-disk file uploads
# (backend/app/api/v1/endpoints/bids.py's upload_doc writes to
# /app/uploads/... via aiofiles) — mounting EFS there means the existing
# code works unmodified across multiple stateless Fargate tasks.
#
# S3: private bucket for the frontend's static Vite build. No bucket
# policy is attached here — the CDN module attaches one scoped to its own
# CloudFront distribution's ARN (avoids a circular module dependency; see
# that module's main.tf).
############################################################################

resource "aws_efs_file_system" "uploads" {
  creation_token  = "${var.name_prefix}-uploads"
  encrypted       = true
  throughput_mode = "bursting"

  tags = merge(var.tags, { Name = "${var.name_prefix}-uploads" })
}

resource "aws_efs_mount_target" "uploads" {
  count           = length(var.private_subnet_ids)
  file_system_id  = aws_efs_file_system.uploads.id
  subnet_id       = var.private_subnet_ids[count.index]
  security_groups = [var.efs_security_group_id]
}

resource "aws_efs_access_point" "uploads" {
  file_system_id = aws_efs_file_system.uploads.id

  posix_user {
    uid = 1000
    gid = 1000
  }

  root_directory {
    path = "/uploads"
    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "755"
    }
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-uploads-ap" })
}

############################################################################
# Frontend static-site bucket
############################################################################

resource "aws_s3_bucket" "frontend" {
  bucket = var.frontend_bucket_name
  tags   = var.tags
}

resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
