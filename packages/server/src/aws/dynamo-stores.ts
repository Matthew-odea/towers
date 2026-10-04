import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { PlayerStats } from '../core/protocol';
import type { ChatRecord, ConnectionRecord, ConnectionStore, GameRecord, GameStore, StatsStore } from '../core/types';

/**
 * Single-table layout (keys: pk, sk; TTL attribute: expiresAt, epoch seconds):
 *   GAME#<id>      / STATE         the game: { rev, json }
 *   GAME#<id>      / CHAT#<ts>#<n> one chat message (not part of STATE, so chat never contends with actions)
 *   GAME#<id>      / CONN#<connId> membership row, used to list a game's connections
 *   CONN#<connId>  / META          the connection: { username, gameId, seat }
 *   STATS#<key>    / STATS         per-username stats: { rev, json }
 */

const isConditionFailure = (e: unknown) =>
  e instanceof ConditionalCheckFailedException || (e as { name?: string })?.name === 'ConditionalCheckFailedException';

export class DynamoGameStore implements GameStore {
  constructor(private readonly db: DynamoDBDocumentClient, private readonly table: string) {}

  async get(id: string): Promise<GameRecord | null> {
    const r = await this.db.send(
      new GetCommand({ TableName: this.table, Key: { pk: `GAME#${id}`, sk: 'STATE' }, ConsistentRead: true }),
    );
    return r.Item ? (JSON.parse(r.Item.json as string) as GameRecord) : null;
  }

  async put(rec: GameRecord, expectedRev: number | null): Promise<boolean> {
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.table,
          Item: { pk: `GAME#${rec.id}`, sk: 'STATE', rev: rec.rev, expiresAt: rec.expiresAt, json: JSON.stringify(rec) },
          ...(expectedRev === null
            ? { ConditionExpression: 'attribute_not_exists(pk)' }
            : { ConditionExpression: 'rev = :r', ExpressionAttributeValues: { ':r': expectedRev } }),
        }),
      );
      return true;
    } catch (e) {
      if (isConditionFailure(e)) return false;
      throw e;
    }
  }

  async addChat(gameId: string, entry: ChatRecord, expiresAt: number): Promise<void> {
    const n = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
    await this.db.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: `GAME#${gameId}`, sk: `CHAT#${String(entry.ts).padStart(15, '0')}#${n}`, ...entry, expiresAt },
      }),
    );
  }

  async listChat(gameId: string, limit: number): Promise<ChatRecord[]> {
    const r = await this.db.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :p AND begins_with(sk, :c)',
        ExpressionAttributeValues: { ':p': `GAME#${gameId}`, ':c': 'CHAT#' },
        ScanIndexForward: false,
        Limit: limit,
        ConsistentRead: true,
      }),
    );
    return (r.Items ?? [])
      .map((it) => ({ from: it.from as ChatRecord['from'], name: it.name as string, text: it.text as string, ts: it.ts as number }))
      .reverse();
  }
}

export class DynamoConnectionStore implements ConnectionStore {
  constructor(private readonly db: DynamoDBDocumentClient, private readonly table: string) {}

  async get(id: string): Promise<ConnectionRecord | null> {
    const r = await this.db.send(
      new GetCommand({ TableName: this.table, Key: { pk: `CONN#${id}`, sk: 'META' }, ConsistentRead: true }),
    );
    // TTL deletion can lag by up to 48 h, so expired rows are ignored explicitly.
    return r.Item && isLive(r.Item) ? toConn(id, r.Item) : null;
  }

  async put(conn: ConnectionRecord): Promise<void> {
    const old = await this.db.send(
      new PutCommand({
        TableName: this.table,
        Item: stripUndefined({
          pk: `CONN#${conn.id}`,
          sk: 'META',
          username: conn.username,
          gameId: conn.gameId,
          seat: conn.seat,
          expiresAt: conn.expiresAt,
        }),
        ReturnValues: 'ALL_OLD',
      }),
    );
    const oldGame = old.Attributes?.gameId as string | undefined;
    if (oldGame && oldGame !== conn.gameId) {
      await this.db.send(new DeleteCommand({ TableName: this.table, Key: { pk: `GAME#${oldGame}`, sk: `CONN#${conn.id}` } }));
    }
    if (conn.gameId) {
      await this.db.send(
        new PutCommand({
          TableName: this.table,
          Item: stripUndefined({
            pk: `GAME#${conn.gameId}`,
            sk: `CONN#${conn.id}`,
            seat: conn.seat,
            username: conn.username,
            expiresAt: conn.expiresAt,
          }),
        }),
      );
    }
  }

  async remove(id: string): Promise<ConnectionRecord | null> {
    const r = await this.db.send(
      new DeleteCommand({ TableName: this.table, Key: { pk: `CONN#${id}`, sk: 'META' }, ReturnValues: 'ALL_OLD' }),
    );
    if (!r.Attributes) return null;
    const conn = toConn(id, r.Attributes);
    if (conn.gameId) {
      await this.db.send(new DeleteCommand({ TableName: this.table, Key: { pk: `GAME#${conn.gameId}`, sk: `CONN#${id}` } }));
    }
    return conn;
  }

  async listByGame(gameId: string): Promise<ConnectionRecord[]> {
    const out: ConnectionRecord[] = [];
    let key: Record<string, unknown> | undefined;
    do {
      const r = await this.db.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: 'pk = :p AND begins_with(sk, :c)',
          ExpressionAttributeValues: { ':p': `GAME#${gameId}`, ':c': 'CONN#', ':now': nowSeconds() },
          FilterExpression: 'expiresAt > :now',
          ConsistentRead: true,
          ExclusiveStartKey: key,
        }),
      );
      for (const it of r.Items ?? []) {
        out.push({ ...toConn((it.sk as string).slice(5), it), gameId });
      }
      key = r.LastEvaluatedKey;
    } while (key);
    return out;
  }
}

export class DynamoStatsStore implements StatsStore {
  constructor(private readonly db: DynamoDBDocumentClient, private readonly table: string) {}

  private async load(key: string) {
    const r = await this.db.send(
      new GetCommand({ TableName: this.table, Key: { pk: `STATS#${key}`, sk: 'STATS' }, ConsistentRead: true }),
    );
    return r.Item ? { rev: (r.Item.rev as number) ?? 0, stats: JSON.parse(r.Item.json as string) as PlayerStats } : null;
  }

  async get(key: string): Promise<PlayerStats | null> {
    return (await this.load(key))?.stats ?? null;
  }

  async update(key: string, fn: (cur: PlayerStats | null) => PlayerStats): Promise<PlayerStats> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const cur = await this.load(key);
      const next = fn(cur?.stats ?? null);
      try {
        await this.db.send(
          new PutCommand({
            TableName: this.table,
            Item: { pk: `STATS#${key}`, sk: 'STATS', rev: (cur?.rev ?? 0) + 1, json: JSON.stringify(next) },
            ...(cur
              ? { ConditionExpression: 'rev = :r', ExpressionAttributeValues: { ':r': cur.rev } }
              : { ConditionExpression: 'attribute_not_exists(pk)' }),
          }),
        );
        return next;
      } catch (e) {
        if (!isConditionFailure(e)) throw e;
      }
    }
    throw new Error('stats update contention');
  }
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const isLive = (it: Record<string, unknown>) => ((it.expiresAt as number) ?? 0) > nowSeconds();

function toConn(id: string, it: Record<string, unknown>): ConnectionRecord {
  return {
    id,
    username: it.username as string | undefined,
    gameId: it.gameId as string | undefined,
    seat: it.seat as ConnectionRecord['seat'],
    expiresAt: (it.expiresAt as number) ?? 0,
  };
}

function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}
