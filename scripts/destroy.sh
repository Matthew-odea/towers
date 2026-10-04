#!/usr/bin/env bash
# Tear down all Towers AWS resources. Run from the repo root.
# Terraform state is local (infra/terraform.tfstate); destroying is irreversible.
set -euo pipefail

for cmd in aws terraform; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "error: '$cmd' not found on PATH" >&2; exit 1; }
done

# The Lambda resource reads build/lambda.zip even on destroy; make sure a file exists.
mkdir -p infra/build
if [ ! -f infra/build/lambda.zip ]; then
  command -v zip >/dev/null 2>&1 || { echo "error: 'zip' not found on PATH" >&2; exit 1; }
  (cd infra/build && printf x > p.txt && zip -q lambda.zip p.txt && rm -f p.txt)
fi

terraform -chdir=infra init -input=false

REGION=$(terraform -chdir=infra output -raw region 2>/dev/null || true)
REGION=${REGION:-${AWS_REGION:-us-east-1}}
echo "AWS identity:"
aws sts get-caller-identity --region "$REGION" --output text --query '[Account,Arn]' || true
echo "Region: $REGION"
echo
echo "This destroys the Towers site, database (all games and stats) and API in the account above."
read -r -p "Type 'destroy' to continue: " answer
[ "$answer" = "destroy" ] || { echo "Aborted."; exit 1; }

# force_destroy on the bucket also empties it; this pre-empt is harmless.
if BUCKET=$(terraform -chdir=infra output -raw bucket_name 2>/dev/null) && [ -n "$BUCKET" ]; then
  echo "==> Emptying s3://$BUCKET"
  aws s3 rm "s3://$BUCKET" --recursive --region "$REGION" || true
fi

terraform -chdir=infra destroy -auto-approve -input=false
