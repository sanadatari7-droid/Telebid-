# Terraform backend blocks can't use variables — these must be the literal
# values `terraform output` printed after `bootstrap/`'s one-time apply.
# See infra/README.md.
terraform {
  backend "s3" {
    bucket         = "telebid-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "telebid-terraform-locks"
    encrypt        = true
  }
}
