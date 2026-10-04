// Hard bot setup (open, turn-based: RULINGS §4). One placement per call.
import { HOME_EDGE, TOWER, neighbors, other, parseHex } from '../../hex';
import { nextSetupPlacer, setupEligible } from '../../setup';
import type { Action, AnyState, PlayerId } from '../../types';
import { activationWays } from '../values';
import type { HardConfig } from './config';

/** Left/right flank of a hex relative to the board axis (-1 / +1, 0 on the axis). */
function flank(h: string): number {
  const [q, r] = parseHex(h);
  return Math.sign(2 * q + r);
}

export function hardSetup(s: AnyState, me: PlayerId, cfg: HardConfig): Action | null {
  const n = nextSetupPlacer(s);
  if (!n || n.player !== me) return null;
  const o = cfg.setup;
  const tower = TOWER[me];
  const foe = other(me);
  const eligible = setupEligible(s, me);
  if (eligible.length === 0) return null;
  const place = (cardId: string, hex: string): Action => ({ type: 'setupPlace', player: me, placements: [{ cardId, hex }] });
  const kind = (id: string) => s.cards[id].kind;
  const ways = (id: string) => activationWays(s.cards[id]);
  const sides = HOME_EDGE[me].filter((h) => h !== tower);

  const foeTroops: Record<string, number> = {};
  for (const p of s.setup[foe].placements) {
    const k = kind(p.cardId);
    if (k === 'commander') continue;
    foeTroops[p.hex] = (foeTroops[p.hex] ?? 0) + (k === 'shardbearer' || k === 'cavalry' ? 1.5 : 1);
  }
  const foeOnFlank = (h: string) =>
    HOME_EDGE[foe].filter((x) => x !== TOWER[foe] && flank(x) === flank(h)).reduce((a, x) => a + (foeTroops[x] ?? 0), 0);
  const plainsAround = (h: string) => neighbors(h).filter((x) => s.terrain[x] === 'plains').length;
  const mine = s.setup[me].placements.filter((p) => kind(p.cardId) !== 'commander');
  const strikePlaced = mine.filter((p) => p.hex !== tower);
  const tie = me === 'red' ? 1 : -1;
  const chooseStrike = (): string => {
    if (o.strike === 'tower') return tower;
    const cmdHex = s.setup[me].placements.find((p) => kind(p.cardId) === 'commander')?.hex;
    if (o.cmd === 'strike' && cmdHex && cmdHex !== tower) return cmdHex;
    if (o.cmd === 'other' && cmdHex && cmdHex !== tower && !o.split) return sides.find((h) => h !== cmdHex) ?? cmdHex;
    if (strikePlaced.length && !o.split) return strikePlaced[0].hex;
    const score = (h: string) => {
      const pl = plainsAround(h);
      const f = foeOnFlank(h);
      const base = o.strike === 'plains' ? pl : o.strike === 'weak' ? pl - 0.6 * f : pl + 0.6 * f;
      // Split: balance the two side hexes.
      const own = o.split ? strikePlaced.filter((p) => p.hex === h).length : 0;
      return base - 3 * own;
    };
    return [...sides].sort((a, b) => score(b) - score(a) || (flank(a) - flank(b)) * tie)[0];
  };

  if (n.step === 'commander') {
    if (o.cmd === 'tower') return place(eligible[0], tower);
    const sh = chooseStrike();
    if (o.cmd === 'other' && sh !== tower) return place(eligible[0], sides.find((h) => h !== sh) ?? sh);
    return place(eligible[0], sh);
  }
  const escortsPlaced = mine.filter((p) => p.hex === tower).length;
  if (o.strike !== 'tower' && escortsPlaced < o.escorts) {
    const heavy = eligible.filter((id) => kind(id) === 'heavy').sort((a, b) => ways(b) - ways(a));
    const light = eligible.filter((id) => kind(id) === 'light').sort((a, b) => ways(b) - ways(a));
    const escort = heavy[0] ?? light[0];
    if (escort) return place(escort, tower);
  }
  const pri = o.pri;
  const best = [...eligible].sort((a, b) => (pri[kind(b)] ?? 0) + ways(b) - ((pri[kind(a)] ?? 0) + ways(a)))[0];
  return place(best, chooseStrike());
}
