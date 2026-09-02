data "aws_caller_identity" "current" {}

locals {
  common_tags = {
    Project     = "telebid"
    Environment = "production"
    ManagedBy   = "terraform"
  }

  # Deterministic ARNs for resources the ecs module creates, computed here
  # (rather than taken as real module outputs) specifically to break what
  # would otherwise be a circular module dependency: the cicd module's IAM
  # policy needs to reference the ECS cluster/service/role ARNs, but the
  # ecs module itself needs the cicd module's ECR repository URL for its
  # task definition's image. IAM role ARNs and ECS cluster/service ARNs
  # are both fully predictable from the names below (which the ecs module
  # is instructed to use for those exact resources), so no actual
  # resource needs to exist yet for these strings to be correct.
  ecs_cluster_name       = "${var.name_prefix}-cluster"
  ecs_service_name       = "${var.name_prefix}-backend"
  ecs_cluster_arn        = "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:cluster/${local.ecs_cluster_name}"
  ecs_service_arn        = "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:service/${local.ecs_cluster_name}/${local.ecs_service_name}"
  ecs_execution_role_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name_prefix}-ecs-execution"
  ecs_task_role_arn      = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name_prefix}-ecs-task"

  # CloudFront distribution IDs are only known after creation, and (per
  # the cicd module's variable comment) taking the cdn module's real
  # distribution ARN here would create a cicd->cdn->ecs->cicd cycle since
  # ecs depends on cicd's ECR output and cdn depends on ecs's ALB output.
  # CloudFront ARNs are global (no region), so this is fully determined by
  # account ID alone; scoping to the account rather than the exact
  # distribution is an acceptable trade since there's only one in this setup.
  cloudfront_distribution_arn_pattern = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/*"
}

# Shared secret CloudFront sends as a custom header to the ALB; the ALB
# listener rejects anything without it, closing the direct-to-ALB bypass.
resource "random_password" "cloudfront_origin_secret" {
  length  = 32
  special = false
}

module "networking" {
  source = "../../modules/networking"

  name_prefix = var.name_prefix
  azs         = var.azs
  tags        = local.common_tags
}

module "database" {
  source = "../../modules/database"

  name_prefix        = var.name_prefix
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
  security_group_id  = module.networking.rds_security_group_id
  multi_az           = var.db_multi_az
  tags               = local.common_tags
}

module "storage" {
  source = "../../modules/storage"

  name_prefix           = var.name_prefix
  vpc_id                = module.networking.vpc_id
  private_subnet_ids    = module.networking.private_subnet_ids
  efs_security_group_id = module.networking.efs_security_group_id
  frontend_bucket_name  = var.frontend_bucket_name
  tags                  = local.common_tags
}

module "cicd" {
  source = "../../modules/cicd"

  name_prefix                         = var.name_prefix
  github_repo                         = var.github_repo
  ecs_cluster_arn                     = local.ecs_cluster_arn
  ecs_service_arn                     = local.ecs_service_arn
  ecs_execution_role_arn              = local.ecs_execution_role_arn
  ecs_task_role_arn                   = local.ecs_task_role_arn
  frontend_bucket_arn                 = module.storage.frontend_bucket_arn
  cloudfront_distribution_arn_pattern = local.cloudfront_distribution_arn_pattern
  tags                                = local.common_tags
}

module "ecs" {
  source = "../../modules/ecs"

  name_prefix                 = var.name_prefix
  aws_region                  = var.aws_region
  vpc_id                      = module.networking.vpc_id
  public_subnet_ids           = module.networking.public_subnet_ids
  private_subnet_ids          = module.networking.private_subnet_ids
  alb_security_group_id       = module.networking.alb_security_group_id
  ecs_tasks_security_group_id = module.networking.ecs_tasks_security_group_id

  ecr_repository_url       = module.cicd.ecr_repository_url
  image_tag                = var.image_tag
  database_url_secret_arn  = module.database.database_url_secret_arn
  efs_file_system_id       = module.storage.efs_file_system_id
  efs_access_point_id      = module.storage.efs_access_point_id
  cloudfront_origin_secret = random_password.cloudfront_origin_secret.result

  desired_count     = var.desired_count
  smtp_host         = var.smtp_host
  smtp_user         = var.smtp_user
  smtp_password     = var.smtp_password
  anthropic_api_key = var.anthropic_api_key
  frontend_url      = var.frontend_url
  app_base_url      = var.app_base_url
  cors_origins      = var.cors_origins

  tags = local.common_tags
}

module "cdn" {
  source = "../../modules/cdn"

  name_prefix                          = var.name_prefix
  frontend_bucket_id                   = module.storage.frontend_bucket_id
  frontend_bucket_arn                  = module.storage.frontend_bucket_arn
  frontend_bucket_regional_domain_name = module.storage.frontend_bucket_regional_domain_name
  alb_dns_name                         = module.ecs.alb_dns_name
  origin_secret                        = random_password.cloudfront_origin_secret.result
  tags                                 = local.common_tags
}
