// A GameConnection that runs the engine locally, with the random bot in the other seat.
// Dev only: used by dev.html to work on the game screen without a server.
import {
  applyAction,
  chooseBotAction,
  createMatch,
  nextSetupPlacer,
  other,
  pendingDecision,
  testing,
  viewFor,
  type Action,
  type GameEvent,
  type MatchState,
  type PlayerId,
} from '@towers/engine';
import type { ChatMessage, ConnectionListener, GameConnection, Presence, StateUpdate } from '../../net/types';

export interface DevOptions {
  seat?: PlayerId;
  /** setup (default) | setupTroop | setupOpp | play | engage | defend | reroll | casualties | retreat | press | tower */
  scenario?: string;
  seed?: string;
  /** Delay before each bot step, ms. */
  botDelay?: number;
  names?: Partial<Record<PlayerId, string>>;
  /** Bot difficulty; when set, the bot seat is shown as "Bot" with its level. */
  level?: 'easy' | 'medium' | 'hard';
}

const { buildState, card, cards } = testing;

function must(s: MatchState, a: Action): MatchState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(`dev scenario: ${r.error}`);
  return r.state;
}

/** Board positions are written for Red at the bottom; mirrored when the human plays Black. */
function scenarioState(name: string, seed: string, seat: PlayerId): MatchState {
  const base = createMatch({ seed, names: { red: 'Adolin', black: 'Venli' }, firstPlayer: name === 'setupOpp' ? other(seat) : seat });
  if (name === 'setup' || name === 'setupOpp') return base;
  /** Bots place for both sides until `stop` says to hand over. */
  const botSetup = (stop: (s: MatchState) => boolean) => {
    let s = base;
    for (let n = nextSetupPlacer(s); n && !stop(s); n = nextSetupPlacer(s)) s = must(s, chooseBotAction(s, n.player)!);
    return s;
  };
  if (name === 'setupTroop') return botSetup((s) => nextSetupPlacer(s)?.step === 'troop' && nextSetupPlacer(s)?.player === seat);
  if (name === 'play') return botSetup(() => false);
  const terrain = { ...base.terrain, '0,0': 'plains' as const, '0,1': 'plains' as const, '1,0': 'forest' as const, '-1,1': 'mountain' as const };
  const me = seat;
  const op = other(seat);
  const m = (h: string) => (seat === 'red' ? h : h.split(',').map((x) => String(-Number(x) + 0)).join(','));
  const board = (spec: Record<string, string[]>) =>
    Object.fromEntries(Object.entries(spec).map(([h, refs]) => [m(h), refs.map((r) => r.replace(/^me:/, `${me}:`).replace(/^op:/, `${op}:`))]));
  const named = (s: MatchState) => ({ ...s, names: base.names });
  switch (name) {
    case 'engage':
      return named(
        buildState({
          seed,
          terrain,
          current: me,
          board: board({
            '-1,2': ['me:K1', 'me:H3'],
            '0,2': ['me:K2'],
            '0,1': ['me:L6', 'me:H7', 'me:S1', 'me:L9'],
            '-1,1': ['me:A1', 'me:V1'],
            '1,0': ['me:L8', 'me:H5'],
            '0,0': ['op:L7', 'op:H6', 'op:S1'],
            '1,-1': ['op:A1', 'op:L5', 'op:V2'],
            '1,-2': ['op:K1', 'op:K2', 'op:H8'],
            '-1,0': ['op:L4'],
          }),
          fortified: [m('1,-1')],
          dice: [3, 4],
        }),
      );
    case 'reroll': {
      const s = buildState({
        seed,
        terrain,
        current: me,
        board: board({
          '-1,2': ['me:K2', 'me:H3'],
          '0,1': ['me:K1', 'me:L8', 'me:S1'],
          '0,0': ['op:L2', 'op:L3'],
          '1,-2': ['op:K1', 'op:K2'],
          '1,0': ['me:L6'],
        }),
        dice: [2, 5, 3, 4, 6, 1, 5],
      });
      return must(named(s), { type: 'engage', player: me, target: m('0,0'), cardIds: [card(`${me}:K1`), card(`${me}:L8`)] });
    }
    case 'casualties': {
      const s = buildState({
        seed,
        terrain,
        current: me,
        board: board({
          '-1,2': ['me:K1', 'me:K2'],
          '0,1': ['me:L4', 'me:H4', 'me:S1'],
          '0,0': ['op:L8', 'op:L5', 'op:L6'],
          '1,-2': ['op:K1', 'op:K2'],
        }),
        dice: [2, 2],
      });
      return must(named(s), { type: 'engage', player: me, target: m('0,0'), cardIds: cards(`${me}:L4`, `${me}:H4`, `${me}:S1`) });
    }
    case 'defend': {
      const s = buildState({
        seed,
        terrain,
        current: op,
        board: board({
          '-1,2': ['me:K1', 'me:K2'],
          '0,1': ['me:L6', 'me:H7', 'me:A1', 'me:W', 'me:L2'],
          '0,0': ['op:L7', 'op:H6', 'op:S1'],
          '1,0': ['op:V1'],
          '1,-2': ['op:K1', 'op:K2'],
        }),
        fortified: [m('0,1')],
        dice: [6, 6, 3],
      });
      return must(named(s), { type: 'engage', player: op, target: m('0,1'), cardIds: cards(`${op}:L7`, `${op}:S1`, `${op}:V1`) });
    }
    case 'retreat': {
      const s = buildState({
        seed,
        terrain,
        current: op,
        board: board({
          '-1,2': ['me:K1', 'me:K2'],
          '0,1': ['me:L6', 'me:H9'],
          '0,0': ['op:L7', 'op:H5'],
          '1,-2': ['op:K1', 'op:K2'],
        }),
        dice: [2, 5],
      });
      return must(named(s), { type: 'engage', player: op, target: m('0,1'), cardIds: cards(`${op}:L7`) });
    }
    case 'press': {
      const s = buildState({
        seed,
        terrain,
        current: me,
        board: board({
          '-1,2': ['me:K1', 'me:K2'],
          '0,1': ['me:L9'],
          '0,0': ['op:L2'],
          '1,-2': ['op:K1', 'op:K2'],
        }),
        dice: [3, 4, 3, 4, 3, 4, 2, 2],
      });
      return must(named(s), { type: 'engage', player: me, target: m('0,0'), cardIds: cards(`${me}:L9`) });
    }
    case 'tower':
    case 'match':
      return named(
        buildState({
          seed,
          terrain,
          current: me,
          board: board({
            '-1,2': ['me:K1', 'me:K2'],
            '1,-2': ['me:V1', 'me:L7'],
            '0,-2': ['op:K1', 'op:K2'],
            '2,-2': ['op:H6'],
          }),
          towerCount: { [me]: 2 },
          roundWins: name === 'match' ? { [me]: 1, [op]: 1 } : {},
          round: name === 'match' ? 3 : 1,
          fortified: [m('-1,2')],
        }),
      );
    default:
      return base;
  }
}

export function createDevConnection(opts: DevOptions = {}): GameConnection {
  const seat: PlayerId = opts.seat ?? 'red';
  const bot = other(seat);
  const delay = opts.botDelay ?? 650;
  let state = scenarioState(opts.scenario ?? 'setup', opts.seed ?? `dev-${Math.random().toString(36).slice(2)}`, seat);
  if (opts.names) state = { ...state, names: { ...state.names, ...opts.names } };
  let version = 1;
  let latest: StateUpdate = { view: viewFor(state, seat), events: [], version };
  const listeners = new Set<ConnectionListener>();
  const chat: ChatMessage[] = [];
  const presence: Presence = {
    red: { name: state.names.red, connected: true, bot: bot === 'red' },
    black: { name: state.names.black, connected: true, bot: bot === 'black' },
  };
  if (opts.level) presence[bot] = { ...presence[bot]!, botLevel: opts.level };
  let timer: number | null = null;
  let closed = false;

  const emit = (events: GameEvent[]) => {
    latest = { view: viewFor(state, seat), events, version: ++version };
    for (const l of listeners) l.onState?.(latest);
  };

  const botStep = () => {
    timer = null;
    if (closed) return;
    const pd = pendingDecision(state);
    if (!(pd.players as PlayerId[]).includes(bot)) return;
    const a = chooseBotAction(state, bot, { level: opts.level ?? 'medium' });
    if (!a) return;
    const r = applyAction(state, a);
    if (!r.ok) {
      console.error('bot action rejected', r.error, a);
      return;
    }
    state = r.state;
    emit(r.events);
    schedule();
  };

  const schedule = () => {
    if (timer !== null || closed) return;
    const pd = pendingDecision(state);
    if ((pd.players as PlayerId[]).includes(bot)) timer = window.setTimeout(botStep, delay);
  };

  // Let the screen mount before the bot moves.
  window.setTimeout(schedule, 400);

  return {
    gameId: 'dev',
    seat,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getLatest: () => latest,
    getChat: () => chat,
    getPresence: () => presence,
    sendAction(a: Action) {
      const r = applyAction(state, a);
      if (!r.ok) {
        for (const l of listeners) l.onError?.({ code: 'illegal', message: r.error });
        return;
      }
      state = r.state;
      emit(r.events);
      schedule();
    },
    sendChat(text: string) {
      const m = { from: seat, name: state.names[seat], text, ts: Date.now() };
      chat.push(m);
      for (const l of listeners) l.onChat?.(m);
    },
    close() {
      closed = true;
      if (timer !== null) window.clearTimeout(timer);
      listeners.clear();
    },
  };
}
