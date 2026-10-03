#!/usr/bin/env bash
# Tear down all Towers AWS resources. Run from the repo root.
set -euo pipefail

for cmd in aws terraform; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "error: '$cmd' not found on PATH" >&2; exit 1; }
done

terraform -chdir=infra init -input=false

if BUCKET=$(terraform -chdir=infra output -raw bucket_name 2>/dev/null) && [ -n "$BUCKET" ]; then
  echo "==> Emptying s3://$BUCKET"
  aws s3 rm "s3://$BUCKET" --recursive || true
fi

terraform -chdir=infra destroy -auto-approve -input=false
