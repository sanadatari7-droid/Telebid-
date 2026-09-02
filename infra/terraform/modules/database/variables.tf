variable "name_prefix" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
  description = "The RDS security group from the networking module (already scoped to accept 5432 from ECS tasks only)."
  type        = string
}

variable "db_name" {
  type    = string
  default = "telebid"
}

variable "db_username" {
  type    = string
  default = "telebid"
}

variable "instance_class" {
  description = "Burstable Graviton instance — cheapest reasonable start; bump if the app's connection pool (asyncpg min_size=2/max_size=20 per task) or CPU needs outgrow it."
  type        = string
  default     = "db.t4g.micro"
}

variable "allocated_storage_gb" {
  type    = number
  default = 20
}

variable "max_allocated_storage_gb" {
  description = "Ceiling for RDS storage autoscaling."
  type        = number
  default     = 100
}

variable "multi_az" {
  description = "Single-AZ by default (cost-conscious). Flip to true for production HA once the app has real users worth protecting from an AZ outage — this is a one-variable change, no other resource changes needed."
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  type    = number
  default = 7
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "postgres_version" {
  type    = string
  default = "16"
}

variable "tags" {
  type    = map(string)
  default = {}
}
