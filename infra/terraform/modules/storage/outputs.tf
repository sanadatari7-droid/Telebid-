output "efs_file_system_id" {
  value = aws_efs_file_system.uploads.id
}

output "efs_access_point_id" {
  value = aws_efs_access_point.uploads.id
}

output "frontend_bucket_id" {
  value = aws_s3_bucket.frontend.id
}

output "frontend_bucket_arn" {
  value = aws_s3_bucket.frontend.arn
}

output "frontend_bucket_regional_domain_name" {
  value = aws_s3_bucket.frontend.bucket_regional_domain_name
}
