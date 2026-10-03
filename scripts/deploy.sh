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
terraform -chdir=infra init -input=false
terraform -chdir=infra apply -auto-approve -input=false

SITE_URL=$(terraform -chdir=infra output -raw site_url)
WS_URL=$(terraform -chdir=infra output -raw ws_url)
BUCKET=$(terraform -chdir=infra output -raw bucket_name)
DIST_ID=$(terraform -chdir=infra output -raw distribution_id)

echo "==> Building client"
npm run build -w @towers/client
DIST=packages/client/dist
printf '{"wsUrl": "%s"}\n' "$WS_URL" > "$DIST/config.json"

echo "==> Uploading to s3://$BUCKET"
aws s3 sync "$DIST" "s3://$BUCKET" --delete \
  --exclude "index.html" --exclude "config.json" --exclude "robots.txt" \
  --cache-control "public,max-age=31536000,immutable"
for f in index.html config.json robots.txt; do
  if [ -f "$DIST/$f" ]; then
    aws s3 cp "$DIST/$f" "s3://$BUCKET/$f" --cache-control "no-cache"
  fi
done

echo "==> Invalidating CloudFront"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null

echo
echo "=============================================="
echo "  Towers is live:  $SITE_URL"
echo "  WebSocket:       $WS_URL"
echo "=============================================="
