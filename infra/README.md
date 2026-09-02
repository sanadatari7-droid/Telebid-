# AWS Infrastructure

Terraform for deploying TeleBid Enterprise to AWS: ECS Fargate (backend),
S3 + CloudFront (frontend), RDS Postgres, EFS (file uploads), and GitHub
Actions CI/CD via OIDC (no long-lived AWS keys). See
`/root/.claude/plans/breezy-questing-boole.md` in the session this was
authored in for the full design rationale, or the comments throughout
`infra/terraform/modules/*/main.tf`.

**Nothing here has been applied.** This is code only — you review it and
run the commands below yourselves.

## Validation status — read this first

This was authored in a sandboxed session whose network policy blocks
`registry.terraform.io`, so `terraform init`/`validate`/`plan` could not
be run here. What **was** verified before you got this:
- `terraform fmt -recursive -diff` — full HCL parse, clean.
- Every module call's inputs cross-checked line-by-line against each
  module's declared variables (no missing required inputs, no typos'd
  variable names).
- Every `module.X.output_name` reference cross-checked against each
  module's actual declared outputs.
- `backend/scripts/apply_schema.py` (the piece everything else depends
  on) was actually run against a live local Postgres, including against
  a completely empty fresh database, and confirmed to bootstrap all 61
  tables + seed data correctly.

What was **not** possible to verify here: the AWS resource arguments
themselves (a wrong attribute name inside a `resource` block, an invalid
enum value, etc.) — only `terraform validate`/`plan` catch those, and
they need a real provider download. **Run `terraform init && terraform
validate` in both `bootstrap/` and `environments/production/` as your
actual first step**, before touching anything else below — if it's clean,
proceed with confidence; if not, the errors will be specific and quick to
fix.

## One-time setup

### 1. Bootstrap the Terraform state backend

```bash
cd infra/terraform/bootstrap
# state_bucket_name must be globally unique — edit variables.tf's default,
# or pass -var state_bucket_name=... below, before applying.
terraform init
terraform validate
terraform apply
terraform output
```

Copy the three outputs (`state_bucket_name`, `lock_table_name`,
`aws_region`) into `../environments/production/backend.tf`'s literal
values (backend blocks can't use variables).

### 2. Configure and apply the main stack

```bash
cd ../environments/production
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars: at minimum change frontend_bucket_name to
# something globally unique. Fill in smtp_/anthropic_ values if you have
# them now (optional — the app degrades gracefully without them).

terraform init
terraform validate
terraform plan   # review what it's about to create
terraform apply
```

This creates the VPC, RDS, EFS, ECR repo, ECS cluster/service/ALB,
CloudFront distribution, and the GitHub OIDC IAM role — and, as part of
the same apply, runs `backend/scripts/apply_schema.py` as a one-off
Fargate task to bootstrap the (currently empty, since no image has been
pushed yet) database. **The ECS service won't have a working image until
you push one** — see step 3.

### 3. First image push (manual, before CI takes over)

```bash
cd ../../../backend
aws ecr get-login-password --region <aws_region> | docker login --username AWS --password-stdin <ecr_repository_url>
docker build -t <ecr_repository_url>:initial .
docker push <ecr_repository_url>:initial

cd ../infra/terraform/environments/production
terraform apply -var image_tag=initial
```

(`<ecr_repository_url>` is `terraform output ecr_repository_url`.)

### 4. Point the frontend's env vars at the real CloudFront domain

The CloudFront domain isn't known until after step 2's apply — that's why
`frontend_url`/`app_base_url`/`cors_origins` default to a placeholder.

```bash
terraform output cloudfront_domain_name
# Uncomment and fill in the three vars at the bottom of terraform.tfvars
# with this value, then:
terraform apply
```

### 5. First frontend deploy (manual)

```bash
cd ../../../../frontend
npm ci && npm run build
aws s3 sync dist/ s3://$(cd ../infra/terraform/environments/production && terraform output -raw frontend_bucket_name) --delete
aws cloudfront create-invalidation --distribution-id $(cd ../infra/terraform/environments/production && terraform output -raw cloudfront_distribution_id) --paths "/*"
```

Visit `https://<cloudfront_domain_name>` — you should see the TeleBid
login/signup page, and signup should work end-to-end (creates a company +
admin, logs you straight in).

### 6. Wire up GitHub Actions

In the repo's Settings → Secrets and variables → Actions, set:

**Variables** (`vars.*` — not secret, just identifiers):
| Name | Value (from `terraform output`) |
|---|---|
| `AWS_ROLE_ARN` | `github_actions_role_arn` |
| `ECR_REPOSITORY_URL` | `ecr_repository_url` |
| `ECS_CLUSTER_NAME` | `ecs_cluster_name` |
| `ECS_SERVICE_NAME` | `ecs_service_name` |
| `FRONTEND_BUCKET_NAME` | `frontend_bucket_name` |
| `CLOUDFRONT_DISTRIBUTION_ID` | `cloudfront_distribution_id` |
| `FRONTEND_URL` / `APP_BASE_URL` / `CORS_ORIGINS` | same values you put in terraform.tfvars in step 4 |
| `SMTP_HOST` / `SMTP_USER` | same as terraform.tfvars, if set |

**Secrets** (`secrets.*`):
| Name | Value |
|---|---|
| `SMTP_PASSWORD` | same as terraform.tfvars, if set |
| `ANTHROPIC_API_KEY` | same as terraform.tfvars, if set |

This last group matters because `terraform.tfvars` is gitignored (it can
hold real credentials) — CI's own `terraform apply` runs need the *same*
values via `TF_VAR_*` environment variables (already wired in
`.github/workflows/deploy-backend.yml`) or it would silently revert them
to defaults on the next push.

From here, every push to `main` touching `backend/**` or
`database/schema.sql` runs `deploy-backend.yml` (build → push → `terraform
apply` → wait for service stability), and every push touching
`frontend/**` runs `deploy-frontend.yml` (build → S3 sync → CloudFront
invalidation).

## Ongoing operations

- **Logs**: CloudWatch Logs group `/ecs/telebid-production-backend`.
- **Rolling back a bad deploy**: `terraform apply -var image_tag=<previous-sha>`, or push a revert commit.
- **Schema changes**: append to `database/schema.sql` using the same
  idempotent style as the rest of the file (`ADD COLUMN IF NOT EXISTS`,
  `CREATE TABLE IF NOT EXISTS`) — every deploy re-runs it safely.
- **Scaling**: bump `desired_count` in `terraform.tfvars`; for real load
  bump `task_cpu`/`task_memory` too (module defaults: 512/1024).
- **Adding a custom domain**: point Route53 (or your registrar) at the
  CloudFront distribution, request an ACM cert (`us-east-1` — CloudFront
  requires certs there regardless of your other resources' region),
  attach it to the distribution's `viewer_certificate`, and add an
  HTTPS:443 listener to the ALB in `modules/ecs/main.tf` (marked with a
  comment at the listener resource) if you also want direct ALB access
  encrypted (not required — CloudFront already gives end users HTTPS
  regardless).
- **Multi-AZ RDS**: set `db_multi_az = true` in terraform.tfvars, apply.
- **HA NAT**: set `single_nat_gateway = false` when calling the
  networking module in `environments/production/main.tf` (roughly doubles
  NAT cost).

## Rough cost

≈ $105–120/month for this lean single-environment setup — dominated by
the NAT gateway (~$33+data), 2 Fargate tasks (~$29), and the ALB
(~$16+LCU). See the plan document referenced above for the itemized
breakdown. Drop `desired_count` to 1 to cut Fargate cost in half if
traffic doesn't yet justify 2 tasks (you lose zero-downtime rolling
deploys in exchange).

## What's not here

Production **application-level** hardening beyond what's built into this
infra (rate limiting, security headers) and Stripe billing are separate,
not-yet-started phases. A custom domain and a staging environment are
designed for (see "Ongoing operations" above and `environments/`'s
structure) but not built — each is a small, additive change once needed.
