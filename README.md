# Towers

A two-player hex-board card strategy game set in the Stormlight Archive. React client, Node server (AWS Lambda + API Gateway WebSocket in production, a plain Node server locally).

Play: https://dgygqiydt9830.cloudfront.net (not indexed by search engines).

## Rules

`docs/rules/RULINGS.md` is the source of truth. Design brief: `docs/DESIGN.md`. Engine API: `docs/ENGINE.md`. Layout and wire protocol: `docs/ARCHITECTURE.md`.

## Local development

    npm install
    npm run dev

Starts the server and the Vite client together. Playing the bot works offline in the browser if the server is unreachable.

## LAN play

    npm start

Builds the client and serves everything on port 8787. Share `http://<lan-ip>:8787` with the other player.

## Tests

    npm test                      # unit tests (engine, server, client)
    npm run sim -- --games 100    # bot-vs-bot simulation, keep batches small
    npm run e2e                   # Playwright; run one spec at a time: npm run e2e -- e2e/pvp.spec.ts

Live checks against a deployment: `npx tsx scripts/smoke.ts <wsUrl>` (WebSocket protocol) and `node scripts/deployed-check.mjs <siteUrl>` (headless browser).

## Deploy and destroy

Needs AWS credentials, Terraform and Node 22.

    npm run deploy          # bundles the Lambda, terraform apply, uploads the client, invalidates CloudFront
    bash scripts/destroy.sh

Terraform state is local (`infra/terraform.tfstate`); back it up, since losing it orphans the stack. Set `budget_email` to enable a monthly cost alarm.

## Cost

Lambda, API Gateway, DynamoDB (on demand), S3 and CloudFront at hobby traffic stay inside or near the free tier: roughly $0 to $2 per month. There is no always-on compute.

## Credits

Art credits are in `CREDITS.md`.
