// The status line: whose move it is and what is asked, in plain words (unit-tested in test/status.test.ts).
import type { PendingDecision, PlayerId } from '@towers/engine';
import { FACTION } from './cardInfo';

/** What the player is doing inside their own free turn. */
export type TurnStep = 'idle' | 'select' | 'engage' | 'deploy' | 'deployPicked' | 'fortify' | 'reinforce' | 'reinforcePicked' | 'spawn';

export interface StatusInput {
  pd: PendingDecision;
  seat: PlayerId;
  /** CP the turn player has left (as currently shown by the spheres). */
  cp: number;
  step?: TurnStep;
  /** Troops (non-Commander cards) each side has placed this setup. */
  troopsPlaced?: Partial<Record<PlayerId, number>>;
}

export interface Status {
  text: string;
  /** The side that must act now (null once the match is over). */
  actor: PlayerId | null;
  mine: boolean;
}

export function possessive(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

const STEP_TEXT: Record<Exclude<TurnStep, 'idle' | 'select'>, string> = {
  engage: 'Engage · commit up to 3',
  deploy: 'Deploy · choose a card',
  deployPicked: 'Deploy · place it on your Tower',
  fortify: 'Fortify · choose a stack',
  reinforce: 'Reinforce · choose a card',
  reinforcePicked: 'Reinforce · choose a hex',
  spawn: 'Spawn Wit · choose a hex',
};

export function statusFor({ pd, seat, cp, step = 'idle', troopsPlaced = {} }: StatusInput): Status {
  if (pd.kind === 'matchOver') return { text: `${FACTION[pd.winner]} win the match`, actor: null, mine: false };
  const actor = pd.players[0] ?? null;
  if (!actor) return { text: '', actor: null, mine: false };
  const mine = actor === seat;
  const who = FACTION[actor];
  const say = (text: string): Status => ({ text, actor, mine });

  switch (pd.kind) {
    case 'setup': {
      if (pd.step === 'commander') {
        const n = pd.placed[actor] + 1;
        const total = pd.placed[actor] + pd.commandersLeft[actor];
        return say(`${mine ? 'Place' : `${who} place`} a Commander (${n} of ${total})`);
      }
      const done = troopsPlaced[actor] ?? 0;
      const total = done + pd.troopsLeft[actor];
      return say(`${mine ? 'Place' : `${who} place`} a card · ${done + 1} of ${total}`);
    }
    case 'turn':
      if (!mine) return say(`${possessive(who)} turn`);
      if (step === 'idle' || step === 'select') return say(`Your turn · ${cp} CP`);
      return say(STEP_TEXT[step]);
    case 'defend':
      return say(mine ? `Defend · commit up to ${pd.max}` : `Waiting for ${who}…`);
    case 'reroll':
      return say(mine ? 'Reroll a die or pass' : `Waiting for ${who}…`);
    case 'pressOrBreak':
      return say(mine ? 'Press or break off' : `Waiting for ${who}…`);
    case 'casualties':
      if (!mine) return say(`Waiting for ${who}…`);
      return say(
        pd.owner === seat
          ? `Choose ${pd.count} ${plural(pd.count, 'casualty', 'casualties')}`
          : `Strike ${pd.count} · choose ${plural(pd.count, 'a card', `${pd.count} cards`)}`,
      );
    case 'retreat':
      return say(mine ? 'Retreat or stay' : `Waiting for ${who}…`);
  }
}
