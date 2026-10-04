import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { GameService, BOT_BUDGET_MS } from '../core/game-service';
import type { Broadcaster } from '../core/types';
import type { ServerMessage } from '../core/protocol';
import { TokenBucketLimiter } from '../core/rate-limit';
import { DynamoConnectionStore, DynamoGameStore, DynamoStatsStore } from './dynamo-stores';

interface WsEvent {
  requestContext: { routeKey: string; connectionId: string; domainName: string; stage: string };
  body?: string | null;
  isBase64Encoded?: boolean;
}
interface WsResult {
  statusCode: number;
  body?: string;
}

const table = () => {
  const t = process.env.TABLE_NAME;
  if (!t) throw new Error('TABLE_NAME is not set');
  return t;
};

let db: DynamoDBDocumentClient | undefined;
// Per-container message limiter: 10-message burst, refilling at 2/s (about 10 per 5 s).
const limiter = new TokenBucketLimiter(10, 2);
const mgmt = new Map<string, ApiGatewayManagementApiClient>();

function doc(): DynamoDBDocumentClient {
  db ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  return db;
}

function broadcasterFor(endpoint: string): Broadcaster {
  let client = mgmt.get(endpoint);
  if (!client) {
    client = new ApiGatewayManagementApiClient({ endpoint });
    mgmt.set(endpoint, client);
  }
  const c = client;
  return {
    async send(connectionId: string, msg: ServerMessage) {
      try {
        await c.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: Buffer.from(JSON.stringify(msg)) }));
        return 'ok';
      } catch (e) {
        const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (err.name === 'GoneException' || err.$metadata?.httpStatusCode === 410) return 'gone';
        throw e;
      }
    },
  };
}

function serviceFor(endpoint: string): GameService {
  return new GameService({
    games: new DynamoGameStore(doc(), table()),
    connections: new DynamoConnectionStore(doc(), table()),
    stats: new DynamoStatsStore(doc(), table()),
    out: broadcasterFor(endpoint),
    limiter,
  });
}

export async function handler(event: WsEvent, context?: { getRemainingTimeInMillis?: () => number }): Promise<WsResult> {
  const { routeKey, connectionId, domainName, stage } = event.requestContext;
  const service = serviceFor(`https://${domainName}/${stage}`);
  switch (routeKey) {
    case '$connect':
      await service.handleConnect(connectionId);
      return { statusCode: 200 };
    case '$disconnect':
      await service.handleDisconnect(connectionId);
      return { statusCode: 200 };
    default: {
      let body = event.body ?? '';
      if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
      // Leave ~5 s after bot play for the broadcast and logging.
      const left = context?.getRemainingTimeInMillis?.();
      const budget = left === undefined ? BOT_BUDGET_MS : Math.max(1000, Math.min(BOT_BUDGET_MS, left - 5000));
      await service.handleMessage(connectionId, body, budget);
      return { statusCode: 200 };
    }
  }
}
