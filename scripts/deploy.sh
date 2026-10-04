#!/usr/bin/env bash
# Build and deploy Towers to AWS. Run from the repo root.
set -euo pipefail

for cmd in aws terraform node npm; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "error: '$cmd' not found on PATH" >&2; exit 1; }
done

[ -d node_modules ] || npm ci

echo "==> Bundling Lambda"
npm run bundle:lambda -w @towers/server

echo "==> Terraform apply"
echo "    NOTE: state is local (infra/terraform.tfstate). Losing it orphans the whole stack, so back it up."
terraform -chdir=infra init -input=false
# Show which account the AWS CLI and Terraform provider will use.
aws sts get-caller-identity --output text --query '[Account,Arn]' || true
terraform -chdir=infra apply -auto-approve -input=false

SITE_URL=$(terraform -chdir=infra output -raw site_url)
WS_URL=$(terraform -chdir=infra output -raw ws_url)
BUCKET=$(terraform -chdir=infra output -raw bucket_name)
DIST_ID=$(terraform -chdir=infra output -raw distribution_id)
REGION=$(terraform -chdir=infra output -raw region)

echo "==> Building client"
npm run build -w @towers/client
DIST=packages/client/dist
printf '{"wsUrl": "%s"}\n' "$WS_URL" > "$DIST/config.json"

echo "==> Uploading to s3://$BUCKET ($REGION)"
# Hashed bundles are immutable. New hashed files go up first (no --delete) so open tabs keep
# working; art/ and favicon.svg are not hashed and get a short cache.
aws s3 sync "$DIST/assets" "s3://$BUCKET/assets" --region "$REGION" \
  --cache-control "public,max-age=31536000,immutable"
aws s3 sync "$DIST" "s3://$BUCKET" --region "$REGION" \
  --exclude "assets/*" --exclude "index.html" --exclude "config.json" --exclude "robots.txt" \
  --cache-control "public,max-age=3600"
for f in index.html config.json robots.txt; do
  if [ -f "$DIST/$f" ]; then
    aws s3 cp "$DIST/$f" "s3://$BUCKET/$f" --region "$REGION" --cache-control "no-cache"
  fi
done
# Only now that the new index.html is live, remove files that are no longer part of the build.
# --size-only: everything is already uploaded, so this pass only removes stale keys.
aws s3 sync "$DIST" "s3://$BUCKET" --region "$REGION" --delete --size-only

echo "==> Invalidating CloudFront"
aws cloudfront create-invalidation --region "$REGION" --distribution-id "$DIST_ID" --paths "/*" >/dev/null

echo
echo "=============================================="
echo "  Towers is live:  $SITE_URL"
echo "  WebSocket:       $WS_URL"
echo "=============================================="
