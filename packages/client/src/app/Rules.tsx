import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CardKind } from '@towers/engine';
import { Glyph } from '../game/Card';

// The player's rulebook. docs/rules/RULINGS.md is the full spec the engine follows; keep the two
// in step when a rule changes.

interface Section {
  id: string;
  title: string;
  body: ReactNode;
}

const ARMY: { kind: CardKind; name: string; count: number; fires: string; note: string }[] = [
  { kind: 'light', name: 'Light Infantry 2–10', count: 9, fires: 'the total equals its rank', note: '' },
  { kind: 'heavy', name: 'Heavy Infantry 2–10', count: 9, fires: 'the total equals its rank', note: 'Its stack Fortifies for 1 CP' },
  { kind: 'archer', name: 'Archer', count: 2, fires: 'either die is a 1', note: 'Shoots from 2 hexes away' },
  { kind: 'cavalry', name: 'Cavalry', count: 2, fires: 'either die is a 6', note: 'Rides 2 Plains hexes; charges' },
  { kind: 'commander', name: 'Commander', count: 2, fires: 'never', note: 'Each one in a fight is a reroll' },
  { kind: 'shardbearer', name: 'Shardbearer', count: 2, fires: 'any doubles, or a total of 7', note: 'Shardstrike on doubles' },
  { kind: 'wit', name: 'Wit', count: 1, fires: 'the number you name, 2–12', note: 'Spawns almost anywhere' },
];

/** Ways to roll each infantry rank on 2d6 (out of 36). */
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => ({ r, ways: 6 - Math.abs(7 - r) }));

function RankOdds() {
  return (
    <div className="rank-odds" aria-label="Chance each rank fires on one roll">
      {RANKS.map(({ r, ways }) => (
        <div key={r} className="rank-col">
          <span className="rank-pct">{Math.round((ways / 36) * 100)}%</span>
          <span className="rank-bar" style={{ height: ways * 9 }} />
          <span className="rank-num numeral">{r}</span>
        </div>
      ))}
    </div>
  );
}

const SECTIONS: Section[] = [
  {
    id: 'winning',
    title: 'Winning',
    body: (
      <>
        <p>Two players, best of three rounds. You win a round by:</p>
        <ul>
          <li>
            <b>Tower</b>: having cards on the enemy Tower at the start of three of your turns in a row. The turn you take it does
            not count, and the count resets if your cards leave or are knocked off.
          </li>
          <li>
            <b>Decapitation</b>: destroying both enemy Commanders. If both sides lose their last Commander in the same fight, the
            attacker wins.
          </li>
          <li>
            <b>Concession</b>: your opponent concedes the round. Anyone can concede at any time from the menu; their surviving
            cards survive.
          </li>
        </ul>
        <p>
          Destroyed cards are gone for the rest of the match. Commanders return every round, and every other surviving card, on
          the board or in Reserve, is yours again next round.
        </p>
        <p>Nothing is hidden: every stack, both Reserves and both destroyed piles are open to both players.</p>
      </>
    ),
  },
  {
    id: 'army',
    title: 'Your army',
    body: (
      <>
        <p>Both players have the same 27 cards. A committed card fires when the two dice match it.</p>
        <table className="rules-table army-table">
          <thead>
            <tr>
              <th />
              <th>Card</th>
              <th>Fires when</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ARMY.map((a) => (
              <tr key={a.kind}>
                <td className="army-glyph">
                  <Glyph kind={a.kind} />
                </td>
                <td>
                  {a.name} <span className="dim">×{a.count}</span>
                </td>
                <td>{a.fires}</td>
                <td className="dim">{a.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          An infantry rank is not its strength, only the total that fires it. Sixes, sevens and eights come up most; a 2 or a 10
          rarely fires but still screens and takes casualties.
        </p>
        <RankOdds />
      </>
    ),
  },
  {
    id: 'board',
    title: 'The board',
    body: (
      <>
        <p>
          Nineteen hexes. Your home edge is the row of three nearest you, and its middle hex is your Tower. Terrain is dealt
          again every round, and it is always the same for both sides when the board is turned around.
        </p>
        <table className="rules-table">
          <tbody>
            <tr>
              <th scope="row">Plains</th>
              <td>Open ground. A stack of only Cavalry can ride through two Plains hexes in one Move.</td>
            </tr>
            <tr>
              <th scope="row">Forest</th>
              <td>Ordinary to move through. Blocks an Archer's line of sight.</td>
            </tr>
            <tr>
              <th scope="row">Mountain</th>
              <td>
                Entering one ends the Move, and the cards that entered stay for the rest of the turn. Defending a Mountain gives
                Advantage; Cavalry fighting on one or into one are at Disadvantage; an Archer shooting down from one has Advantage.
              </td>
            </tr>
            <tr>
              <th scope="row">Tower</th>
              <td>Ordinary ground. Hold the enemy's to win.</td>
            </tr>
          </tbody>
        </table>
      </>
    ),
  },
  {
    id: 'setup',
    title: 'Setup',
    body: (
      <>
        <p>Setup is open: both players see every card as it is placed.</p>
        <ol>
          <li>
            The round's first player (random in round one, then alternating) places both Commanders, one at a time, on any of
            their home-edge hexes. Then the other player does the same.
          </li>
          <li>Players then take turns placing one card each on their home edge until each has placed six. Any card but Wit.</li>
          <li>Everything else, Wit included, starts in your Reserve. The first player takes the first turn.</li>
        </ol>
      </>
    ),
  },
  {
    id: 'turn',
    title: 'Your turn',
    body: (
      <>
        <p>
          You get 4 CP every turn and lose whatever you do not spend. Spend it in any order, but no more than 3 CP on any one
          action in a turn.
        </p>
        <table className="rules-table action-table">
          <tbody>
            <tr>
              <th scope="row">Move</th>
              <td className="numeral cost">1</td>
              <td>Move a stack, or part of it, one hex. An all-Cavalry stack can ride two Plains hexes.</td>
            </tr>
            <tr>
              <th scope="row">Engage</th>
              <td className="numeral cost">1</td>
              <td>Attack an enemy hex.</td>
            </tr>
            <tr>
              <th scope="row">Deploy</th>
              <td className="numeral cost">1</td>
              <td>Put one Reserve card (not Wit) on your Tower, unless enemy cards hold it.</td>
            </tr>
            <tr>
              <th scope="row">Withdraw</th>
              <td className="numeral cost">1</td>
              <td>Move cards one hex closer to your Tower, or from your Tower back into Reserve.</td>
            </tr>
            <tr>
              <th scope="row">Fortify</th>
              <td className="numeral cost">2</td>
              <td>Dig a stack in. 1 CP if it has Heavy Infantry.</td>
            </tr>
            <tr>
              <th scope="row">Reinforce</th>
              <td className="numeral cost">3</td>
              <td>Send one Reserve card to a Fortified hex along a supply line.</td>
            </tr>
            <tr>
              <th scope="row">Spawn Wit</th>
              <td className="numeral cost">1</td>
              <td>Put Wit on the board.</td>
            </tr>
            <tr>
              <th scope="row">End turn</th>
              <td className="numeral cost">0</td>
              <td />
            </tr>
          </tbody>
        </table>
        <p>
          A stack can keep moving: every Move costs 1 CP, so it can go up to three hexes a turn, or six for Cavalry on open
          Plains. Cards can also fight more than once if you pay again. There is no undo.
        </p>
      </>
    ),
  },
  {
    id: 'moving',
    title: 'Moving',
    body: (
      <>
        <ul>
          <li>
            <b>Stacks</b> hold up to four cards, all of one player's. Move all of a stack or any part of it; the rest stay. Nothing
            can push a stack past four, whether it is a Move, a Deploy, a Reinforce, a Spawn or a retreat.
          </li>
          <li>You cannot enter an enemy hex: clear it by fighting. Winning a fight never moves you in.</li>
          <li>
            <b>Cavalry</b>: a stack of only Cavalry can ride through one Plains hex into another for a single Move, if both have
            room. If your very next action is an Engage with one of those riders, your side has Advantage. Anything else in
            between loses the charge.
          </li>
          <li>
            <b>Mountains</b> end a Move. Cards that entered one stay put until your next turn, though they can still fight.
          </li>
          <li>
            <b>Withdraw</b> moves cards to a hex closer to your Tower. It counts separately from Move for the 3 CP limit. From your
            own Tower it can send cards back to Reserve, but never Commanders.
          </li>
          <li>
            <b>Spawn Wit</b> puts Wit from your Reserve on any hex without enemy cards, except the two Towers and the hexes next to
            them. After that it is an ordinary card.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'fighting',
    title: 'Fighting',
    body: (
      <>
        <ol>
          <li>
            Engage an enemy hex and commit one to three cards from hexes next to it, or Archers exactly two hexes away that can
            see it. Committing Wit means naming its number.
          </li>
          <li>The defender sees your commitment, then commits one to three cards from that hex, or up to four if it is Fortified.</li>
          <li>Roll two dice. Both sides read the same dice, then rerolls are offered.</li>
          <li>
            Every committed card that fires is an activation.
            <ul>
              <li>Only one side activates: it wins.</li>
              <li>
                Both activate: the side with Advantage wins. If neither has it, or both do, it is a <b>Bloodbath</b> and each side
                loses one card.
              </li>
              <li>
                Neither activates: a stale roll. The attacker Presses (rolls again with the same cards, for free) or Breaks off.
                After three stale rolls the defender has Advantage.
              </li>
            </ul>
          </li>
        </ol>
        <p>
          <b>Archers at range</b> need line of sight, which is blocked only when every hex between them and the target is Forest.
          They do not count towards Flanking, and they can only be hit if the defenders fired back with an Archer. Otherwise a
          failed shot simply ends the fight for them.
        </p>
      </>
    ),
  },
  {
    id: 'rerolls',
    title: 'Rerolls',
    body: (
      <ul>
        <li>Each committed Commander lets you reroll one die once in that fight. The new number stands.</li>
        <li>
          If your opponent has Disadvantage, once per fight you may make them reroll one die, at a moment when they are firing.
        </li>
        <li>
          After each roll the defender goes first, and players take turns using a reroll or passing until both pass. Rerolls are
          not restored when the attacker Presses.
        </li>
      </ul>
    ),
  },
  {
    id: 'advantage',
    title: 'Advantage',
    body: (
      <>
        <p>
          <b>Advantage</b> lets a side also fire on an 11 or 12, as one extra activation, and wins when both sides fire. You have
          it when:
        </p>
        <ul>
          <li>you defend a Fortified hex, or a Mountain;</li>
          <li>you attack with a Cavalry charge;</li>
          <li>your attacking Archer stands on a Mountain and the target does not;</li>
          <li>you Flank: your adjacent committed cards come from at least two hexes around the target that do not touch each other;</li>
          <li>you are defending after three stale rolls.</li>
        </ul>
        <p>
          <b>Disadvantage</b> lets your opponent force one reroll in the fight. You have it when:
        </p>
        <ul>
          <li>you commit Cavalry that stand on a Mountain or attack into one;</li>
          <li>you defend with an Archer while an attacker is next to you;</li>
          <li>you are Surrounded: attackers committed from three or more hexes around you. That also counts as Flanking.</li>
        </ul>
        <p>Neither stacks, and one side can have both at once.</p>
      </>
    ),
  },
  {
    id: 'casualties',
    title: 'Casualties',
    body: (
      <ul>
        <li>
          The winner destroys one card, or two if it had two or more activations. A Bloodbath is always one each. Only committed
          cards can die, and a side never loses more than it committed.
        </li>
        <li>The losing side chooses its casualties, unless the winner had Advantage and the loser Disadvantage: then the winner chooses.</li>
        <li>
          <b>Shardstrike</b>: if a Shardbearer fired on doubles and its side wins, that side picks one of the casualties. In a
          Bloodbath it picks the enemy's one.
        </li>
        <li>
          <b>Retreat</b>: a defender that lost and still has cards may move the whole stack one hex for free, to a hex with no
          enemies, room for all of it, and no attacking hex next to it. It loses its Fortify. Retreating is optional.
        </li>
      </ul>
    ),
  },
  {
    id: 'fortify',
    title: 'Fortify and supply',
    body: (
      <ul>
        <li>
          <b>Fortify</b> a stack that has not moved or arrived this turn: 2 CP, or 1 with Heavy Infantry. It then defends with
          Advantage and up to four cards. Cards that join it are fortified too; it ends when the hex empties or the stack
          retreats.
        </li>
        <li>
          A <b>supply line</b> is a chain of touching hexes from your Tower to a hex, every one of them, your Tower included,
          holding at least one of your cards.
        </li>
        <li>
          <b>Reinforce</b> (3 CP) sends one Reserve card, not Wit, to a Fortified hex with a supply line and room for it.
        </li>
      </ul>
    ),
  },
];

export function Rules() {
  const scroller = useRef<HTMLElement>(null);
  const [active, setActive] = useState(SECTIONS[0].id);

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id.replace(/^rules-/, ''));
      },
      { root, rootMargin: '-15% 0px -70% 0px' },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(`rules-${s.id}`);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  // The app routes on the URL hash, so the contents scroll instead of linking to anchors.
  const go = (id: string) => document.getElementById(`rules-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <main className="rules storm-field" ref={scroller}>
      <a className="back-link" href="#/" aria-label="Back">
        <span aria-hidden>&larr;</span>
      </a>
      <div className="rules-inner">
        <nav className="rules-toc" aria-label="Contents">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className={s.id === active ? 'is-on' : ''} onClick={() => go(s.id)}>
              {s.title}
            </button>
          ))}
        </nav>
        <article className="rules-body">
          <h1 className="rules-title">Rules</h1>
          {SECTIONS.map((s) => (
            <section key={s.id} id={`rules-${s.id}`} aria-labelledby={`rules-${s.id}-h`}>
              <h2 id={`rules-${s.id}-h`}>{s.title}</h2>
              {s.body}
            </section>
          ))}
        </article>
      </div>
    </main>
  );
}
