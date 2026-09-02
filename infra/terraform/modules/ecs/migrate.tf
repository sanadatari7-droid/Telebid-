############################################################################
# Runs backend/scripts/apply_schema.py as a one-off Fargate task, using the
# exact same task definition (so it inherits the same VPC subnets/security
# group and therefore can reach the private RDS instance) with the
# container command overridden. Re-runs whenever the task definition
# changes (i.e. every deploy with a new image) — safe, since schema.sql is
# idempotent throughout.
#
# Requires the `aws` CLI on whatever machine runs `terraform apply`
# (GitHub-hosted Actions runners have it preinstalled; see
# .github/workflows/deploy-backend.yml).
############################################################################

resource "null_resource" "apply_schema" {
  triggers = {
    task_definition_arn = aws_ecs_task_definition.backend.arn
  }

  provisioner "local-exec" {
    interpreter = ["/bin/bash", "-c"]
    command     = <<-EOT
      set -euo pipefail

      TASK_ARN=$(aws ecs run-task \
        --region "${var.aws_region}" \
        --cluster "${aws_ecs_cluster.this.arn}" \
        --task-definition "${aws_ecs_task_definition.backend.arn}" \
        --launch-type FARGATE \
        --network-configuration "awsvpcConfiguration={subnets=[${join(",", var.private_subnet_ids)}],securityGroups=[${var.ecs_tasks_security_group_id}],assignPublicIp=DISABLED}" \
        --overrides '{"containerOverrides":[{"name":"${local.container_name}","command":["python","scripts/apply_schema.py"]}]}' \
        --query 'tasks[0].taskArn' --output text)

      echo "Schema-apply task started: $TASK_ARN"

      aws ecs wait tasks-stopped \
        --region "${var.aws_region}" \
        --cluster "${aws_ecs_cluster.this.arn}" \
        --tasks "$TASK_ARN"

      EXIT_CODE=$(aws ecs describe-tasks \
        --region "${var.aws_region}" \
        --cluster "${aws_ecs_cluster.this.arn}" \
        --tasks "$TASK_ARN" \
        --query 'tasks[0].containers[0].exitCode' --output text)

      if [ "$EXIT_CODE" != "0" ]; then
        echo "apply_schema.py failed (container exit code $EXIT_CODE) — check CloudWatch Logs group ${aws_cloudwatch_log_group.backend.name}" >&2
        exit 1
      fi

      echo "Schema applied successfully."
    EOT
  }

  depends_on = [aws_ecs_task_definition.backend]
}
