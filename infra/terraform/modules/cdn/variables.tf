variable "name_prefix" {
  type = string
}

variable "frontend_bucket_id" {
  type = string
}

variable "frontend_bucket_arn" {
  type = string
}

variable "frontend_bucket_regional_domain_name" {
  type = string
}

variable "alb_dns_name" {
  description = "From the ecs module. CloudFront's /api/* behavior forwards here."
  type        = string
}

variable "origin_secret" {
  description = "Same shared secret passed to the ecs module — sent as a custom header on every CloudFront->ALB request; the ALB listener rejects anything without it."
  type        = string
  sensitive   = true
}

variable "price_class" {
  description = "PriceClass_100 = North America + Europe edge locations only, cheapest tier."
  type        = string
  default     = "PriceClass_100"
}

variable "tags" {
  type    = map(string)
  default = {}
}
