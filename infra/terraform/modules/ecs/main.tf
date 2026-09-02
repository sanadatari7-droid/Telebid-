data "aws_caller_identity" "current" {}

resource "aws_ecs_cluster" "this" {
  name = "${var.name_prefix}-cluster"
  tags = var.tags
}

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${var.name_prefix}-backend"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

############################################################################
# IAM
############################################################################

data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "${var.name_prefix}-ecs-execution-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = "secretsmanager:GetSecretValue"
      Resource = [
        var.database_url_secret_arn,
        aws_secretsmanager_secret.jwt_secret.arn,
        aws_secretsmanager_secret.smtp_password.arn,
        aws_secretsmanager_secret.anthropic_api_key.arn,
      ]
    }]
  })
}

# Task role: the app itself makes zero AWS SDK calls (Anthropic/SMTP are
# plain outbound HTTPS via httpx/aiosmtplib), so this stays near-empty.
# Kept as a distinct role from the execution role on principle — anything
# the app needs from AWS directly in the future attaches here, not to the
# execution role which controls ECR/Secrets Manager access.
resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
  tags               = var.tags
}

############################################################################
# Task definition
############################################################################

locals {
  container_name = "backend"

  environment = [
    { name = "JWT_ALGORITHM", value = var.jwt_algorithm },
    { name = "JWT_ACCESS_TOKEN_EXPIRE_MINUTES", value = tostring(var.jwt_access_token_expire_minutes) },
    { name = "JWT_REFRESH_TOKEN_EXPIRE_DAYS", value = tostring(var.jwt_refresh_token_expire_days) },
    { name = "SMTP_HOST", value = var.smtp_host },
    { name = "SMTP_PORT", value = tostring(var.smtp_port) },
    { name = "SMTP_USER", value = var.smtp_user },
    { name = "SMTP_FROM", value = var.smtp_from },
    { name = "SMTP_TLS", value = tostring(var.smtp_tls) },
    { name = "APP_BASE_URL", value = var.app_base_url },
    { name = "FRONTEND_URL", value = var.frontend_url },
    { name = "MAX_FILE_SIZE_MB", value = tostring(var.max_file_size_mb) },
    { name = "MAX_FAILED_LOGINS", value = tostring(var.max_failed_logins) },
    { name = "BCRYPT_ROUNDS", value = tostring(var.bcrypt_rounds) },
    { name = "CORS_ORIGINS", value = var.cors_origins },
    { name = "ANTHROPIC_MODEL", value = var.anthropic_model },
  ]

  secrets = [
    { name = "DATABASE_URL", valueFrom = var.database_url_secret_arn },
    { name = "JWT_SECRET_KEY", valueFrom = aws_secretsmanager_secret.jwt_secret.arn },
    { name = "SMTP_PASSWORD", valueFrom = aws_secretsmanager_secret.smtp_password.arn },
    { name = "ANTHROPIC_API_KEY", valueFrom = aws_secretsmanager_secret.anthropic_api_key.arn },
  ]
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "${var.name_prefix}-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = local.container_name
      image     = "${var.ecr_repository_url}:${var.image_tag}"
      essential = true
      portMappings = [{
        containerPort = 8000
        protocol      = "tcp"
      }]
      environment = local.environment
      secrets     = local.secrets
      mountPoints = [{
        sourceVolume  = "uploads"
        containerPath = "/app/uploads"
      }]
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8000/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.backend.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "backend"
        }
      }
    }
  ])

  volume {
    name = "uploads"
    efs_volume_configuration {
      file_system_id     = var.efs_file_system_id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = var.efs_access_point_id
        iam             = "ENABLED"
      }
    }
  }

  tags = var.tags
}

############################################################################
# ALB — HTTP:80 only for now (no domain/cert yet). Add an HTTPS:443
# listener + aws_acm_certificate here once a domain exists; everything
# else in this module already supports it unchanged.
############################################################################

resource "aws_lb" "this" {
  name               = "${var.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.alb_security_group_id]
  subnets            = var.public_subnet_ids

  tags = var.tags
}

resource "aws_lb_target_group" "backend" {
  name        = "${var.name_prefix}-backend-tg"
  port        = 8000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    matcher             = "200"
  }

  tags = var.tags
}

# Default action rejects anything that didn't match the CloudFront-only
# rule below — closes the direct-to-ALB bypass with no domain/WAF needed.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "cloudfront_only" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 1

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }

  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [var.cloudfront_origin_secret]
    }
  }
}

############################################################################
# Service
############################################################################

resource "aws_ecs_service" "backend" {
  name            = "${var.name_prefix}-backend"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_tasks_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = local.container_name
    container_port   = 8000
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60

  depends_on = [aws_lb_listener_rule.cloudfront_only]

  tags = var.tags
}
