variable "name_prefix" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "efs_security_group_id" {
  description = "EFS security group from the networking module (already scoped to NFS from ECS tasks only)."
  type        = string
}

variable "frontend_bucket_name" {
  description = "Globally-unique S3 bucket name for the frontend static build."
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
