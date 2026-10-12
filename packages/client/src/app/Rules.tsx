import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HOME_EDGE, buildAllCards, createMatch, type CardKind, type Terrain } from '@towers/engine';
import { CardView, Glyph, type CardMark } from '../game/Card';
import { StillDie } from '../game/Dice';
import { TerrainHex, TerrainLayer } from '../game/Terrain';
import { FACTION } from '../game/cardInfo';
import { HEX, STAGE_H, STAGE_W, hexCenter, hexCorners, polyPoints } from '../game/geometry';
import { useEscapeTo } from './route';

// The player's rulebook. docs/rules/RULINGS.md is the full spec the engine follows; keep the two
// in step when a rule changes. Pictures are drawn with the game's own pieces: cards, dice,
// terrain and CP spheres.

const CARDS = buildAllCards();
/** A sample board for the pictures (deterministic). */
const SAMPLE_TERRAIN = createMatch({ seed: 'rulebook' }).terrain;

// ---- pictures ------------------------------------------------------------------------------

/** CP cost as Kholin spheres (Stormlight stays reserved for things you can act on). */
function Cost({ n }: { n: number }) {
  return (
    <span className="rules-cost spheres--red" aria-label={`${n} CP`}>
      {n === 0 ? <i className="sphere" /> : Array.from({ length: n }, (_, i) => <i key={i} className="sphere is-on" />)}
    </span>
  );
}

function Flag() {
  return (
    <svg className="rules-icon" viewBox="0 0 24 24" aria-hidden>
      <path d="M5 2.5h1.6V22H5z" fill="currentColor" />
      <path d="M7 3.5c3-1.4 5.2 1 8.4-.3 1.4-.5 2.6-.4 3.6.1v9.4c-1-.5-2.2-.6-3.6-.1-3.2 1.3-5.4-1.1-8.4.3z" fill="currentColor" opacity="0.85" />
    </svg>
  );
}

/** The sample board, your side at the bottom, your home edge outlined. */
function BoardFigure() {
  const outline = (h: string, mine: boolean) => (
    <polygon key={h} points={polyPoints(hexCorners(hexCenter(h, 'red'), HEX - 6))} className={`edge-mark ${mine ? 'edge-mark--mine' : ''}`} />
  );
  return (
    <figure className="rules-board">
      <div className="rules-board-art" style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }}>
        <TerrainLayer terrain={SAMPLE_TERRAIN} seat="red" />
        <svg className="rules-board-marks" viewBox={`${-STAGE_W / 2} ${-STAGE_H / 2} ${STAGE_W} ${STAGE_H}`} aria-hidden>
          {HOME_EDGE.black.map((h) => outline(h, false))}
          {HOME_EDGE.red.map((h) => outline(h, true))}
        </svg>
      </div>
      <figcaption>
        Your side is at the bottom. The outlined row is your home edge, with your Tower in the middle; the enemy's is across
        the board.
      </figcaption>
    </figure>
  );
}

function Mini({ id, marks, width = 58 }: { id: string; marks?: CardMark[]; width?: number }) {
  return <CardView card={CARDS[id]} width={width} marks={marks} />;
}

interface Side {
  label: string;
  cards: string[];
  /** Cards that fire on the final dice. */
  fire: string[];
  note?: string;
}

/** A worked example: both committed groups, the dice between them, and what happens. */
function Example({ title, atk, def, dice, children }: { title: string; atk: Side; def: Side; dice: ReactNode; children: ReactNode }) {
  const side = (s: Side, cls: string) => (
    <div className={`ex-side ${cls}`}>
      <span className="ex-label caps">{s.label}</span>
      <div className="ex-cards">
        {s.cards.map((id) => (
          <Mini key={id} id={id} marks={s.fire.includes(id) ? ['lit'] : ['dim']} />
        ))}
      </div>
      {s.note && <span className="ex-note">{s.note}</span>}
    </div>
  );
  return (
    <figure className="rules-example">
      <span className="ex-title caps">Example · {title}</span>
      <div className="ex-scene">
        {side(atk, 'ex-side--atk')}
        <div className="ex-dice">{dice}</div>
        {side(def, 'ex-side--def')}
      </div>
      <figcaption>{children}</figcaption>
    </figure>
  );
}

function Dice({ a, b, from }: { a: number; b: number; from?: number }) {
  return (
    <>
      {from !== undefined && (
        <>
          <StillDie value={from} size={34} faded />
          <span className="ex-arrow" aria-label="rerolled to">
            &rarr;
          </span>
        </>
      )}
      <StillDie value={a} size={34} />
      <StillDie value={b} size={34} />
    </>
  );
}

const K = FACTION.red;
const S = FACTION.black;

// ---- content -------------------------------------------------------------------------------

interface Section {
  id: string;
  title: string;
  body: ReactNode;
}

const ARMY: { id: string; kind: CardKind; name: string; count: number; fires: string; note: string }[] = [
  { id: 'red-light-7', kind: 'light', name: 'Light Infantry 2–10', count: 9, fires: 'the total equals its rank', note: '' },
  { id: 'red-heavy-8', kind: 'heavy', name: 'Heavy Infantry 2–10', count: 9, fires: 'the total equals its rank', note: 'Its stack Fortifies for 1 CP' },
  { id: 'red-archer-lunamor', kind: 'archer', name: 'Archer', count: 2, fires: 'either die is a 1', note: 'Shoots from 2 hexes away' },
  { id: 'red-cavalry-lift', kind: 'cavalry', name: 'Cavalry', count: 2, fires: 'either die is a 6', note: 'Rides 2 Plains hexes; charges' },
  { id: 'red-commander-dalinar', kind: 'commander', name: 'Commander', count: 2, fires: 'never', note: 'Each one in a fight is a reroll' },
  { id: 'red-shardbearer-kaladin', kind: 'shardbearer', name: 'Shardbearer', count: 2, fires: 'any doubles, or a total of 7', note: 'Shardstrike on doubles' },
  { id: 'red-wit-hoid', kind: 'wit', name: 'Wit', count: 1, fires: 'the number you name, 2–12', note: 'Spawns almost anywhere' },
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

const TERRAIN: { t: Terrain; name: string; text: string }[] = [
  { t: 'plains', name: 'Plains', text: 'Open ground. A stack of only Cavalry can ride through two Plains hexes in one Move.' },
  { t: 'forest', name: 'Forest', text: "Ordinary to move through. Blocks an Archer's line of sight." },
  {
    t: 'mountain',
    name: 'Mountain',
    text: 'Entering one ends the Move, and the cards that entered stay for the rest of the turn. Defending a Mountain gives Advantage; Cavalry fighting on one or into one are at Disadvantage; an Archer shooting down from one has Advantage.',
  },
  { t: 'tower', name: 'Tower', text: "Ordinary ground. Hold the enemy's to win." },
];

const ACTIONS: { name: string; cost: number; text: string }[] = [
  { name: 'Move', cost: 1, text: 'Move a stack, or part of it, one hex. An all-Cavalry stack can ride two Plains hexes.' },
  { name: 'Engage', cost: 1, text: 'Attack an enemy hex.' },
  { name: 'Deploy', cost: 1, text: 'Put one Reserve card (not Wit) on your Tower, unless enemy cards hold it.' },
  { name: 'Withdraw', cost: 1, text: 'Move cards one hex closer to your Tower, or from your Tower back into Reserve.' },
  { name: 'Fortify', cost: 2, text: 'Dig a stack in. Only 1 CP if it has Heavy Infantry.' },
  { name: 'Reinforce', cost: 3, text: 'Send one Reserve card to a Fortified hex along a supply line.' },
  { name: 'Spawn Wit', cost: 1, text: 'Put Wit on the board.' },
  { name: 'End turn', cost: 0, text: '' },
];

const SECTIONS: Section[] = [
  {
    id: 'winning',
    title: 'Winning',
    body: (
      <>
        <p>Two players, best of three rounds. You win a round by:</p>
        <ul className="rules-icons">
          <li>
            <TerrainHex t="tower" size={44} />
            <span>
              <b>Tower</b>: having cards on the enemy Tower at the start of three of your turns in a row. The turn you take it
              does not count, and the count resets if your cards leave or are knocked off.
            </span>
          </li>
          <li>
            <span className="rules-icon-pair">
              <Glyph kind="commander" />
              <Glyph kind="commander" />
            </span>
            <span>
              <b>Decapitation</b>: destroying both enemy Commanders. If both sides lose their last Commander in the same fight,
              the attacker wins.
            </span>
          </li>
          <li>
            <Flag />
            <span>
              <b>Concession</b>: your opponent concedes the round. Anyone can concede at any time from the menu; their surviving
              cards survive.
            </span>
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
                <td className="army-card">
                  <Mini id={a.id} width={40} />
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
          rarely fires but still screens and takes casualties. The spheres on an infantry card show how often it fires.
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
          Nineteen hexes. Terrain is dealt again every round, and it is always the same for both sides when the board is turned
          around.
        </p>
        <BoardFigure />
        <table className="rules-table terrain-table">
          <tbody>
            {TERRAIN.map((t) => (
              <tr key={t.t}>
                <td className="terrain-swatch">
                  <TerrainHex t={t.t} size={46} seed="1,0" />
                </td>
                <th scope="row">{t.name}</th>
                <td>{t.text}</td>
              </tr>
            ))}
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
            {ACTIONS.map((a) => (
              <tr key={a.name}>
                <th scope="row">{a.name}</th>
                <td className="cost">
                  <Cost n={a.cost} />
                </td>
                <td>{a.text}</td>
              </tr>
            ))}
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
      <ul>
        <li>
          <b>Stacks</b> hold up to four cards, all of one player's. Move all of a stack or any part of it; the rest stay. Nothing
          can push a stack past four, whether it is a Move, a Deploy, a Reinforce, a Spawn or a retreat.
        </li>
        <li>You cannot enter an enemy hex: clear it by fighting. Winning a fight never moves you in.</li>
        <li>
          <b>Cavalry</b>: a stack of only Cavalry can ride through one Plains hex into another for a single Move, if both have
          room. If your very next action is an Engage with one of those riders, your side has Advantage. Anything else in between
          loses the charge.
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
        <Example
          title="Bloodbath"
          atk={{ label: `${K} attack`, cards: ['red-light-7', 'red-heavy-9'], fire: ['red-light-7'] }}
          def={{ label: `${S} defend`, cards: ['black-heavy-7', 'black-light-4'], fire: ['black-heavy-7'] }}
          dice={<Dice a={3} b={4} />}
        >
          A total of 7 fires a card on each side and neither has Advantage, so each side loses one card.
        </Example>
        <p>
          <b>Archers at range</b> need line of sight, which is blocked only when every hex between them and the target is Forest.
          They do not count towards Flanking, and they can only be hit if the defenders fired back with an Archer. Otherwise a
          failed shot simply ends the fight for them.
        </p>
        <Example
          title="A safe shot"
          atk={{ label: `${K} shoot from 2 hexes`, cards: ['red-archer-lunamor'], fire: ['red-archer-lunamor'] }}
          def={{ label: `${S} defend`, cards: ['black-light-7'], fire: ['black-light-7'] }}
          dice={<Dice a={1} b={6} />}
        >
          Lunamor fires on the 1 and Light 7 fires on the total: a Bloodbath. The {S} fired no Archer, so Lunamor is safe and
          only the {S} lose a card.
        </Example>
      </>
    ),
  },
  {
    id: 'rerolls',
    title: 'Rerolls',
    body: (
      <>
        <ul>
          <li>Each committed Commander lets you reroll one die once in that fight. The new number stands.</li>
          <li>
            If your opponent has Disadvantage, once per fight you may make them reroll one die, at a moment when they are
            firing.
          </li>
          <li>
            After each roll the defender goes first, and players take turns using a reroll or passing until both pass. Rerolls
            are not restored when the attacker Presses.
          </li>
        </ul>
        <Example
          title="A Commander's reroll"
          atk={{ label: `${K} attack`, cards: ['red-commander-dalinar', 'red-light-8'], fire: ['red-light-8'] }}
          def={{ label: `${S} defend`, cards: ['black-light-5', 'black-heavy-10'], fire: [] }}
          dice={<Dice from={2} a={3} b={5} />}
        >
          The roll is 2 and 5: nothing fires. The {S} pass; the {K} spend Dalinar to reroll the 2, which comes up 3. Now the
          total is 8, Light 8 fires, and the {K} win.
        </Example>
      </>
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
        <Example
          title="Fortified on an 11"
          atk={{ label: `${S} attack`, cards: ['black-cavalry-leshwi', 'black-light-5'], fire: ['black-cavalry-leshwi'] }}
          def={{ label: `${K} defend, Fortified`, cards: ['red-heavy-8', 'red-heavy-3'], fire: [], note: 'Advantage: fires on 11' }}
          dice={<Dice a={6} b={5} />}
        >
          Leshwi fires on the 6. The {K} are Fortified, so the 11 is an activation for them too. Both sides fire and only the{' '}
          {K} have Advantage: they win.
        </Example>
      </>
    ),
  },
  {
    id: 'casualties',
    title: 'Casualties',
    body: (
      <>
        <ul>
          <li>
            The winner destroys one card, or two if it had two or more activations. A Bloodbath is always one each. Only
            committed cards can die, and a side never loses more than it committed.
          </li>
          <li>
            The losing side chooses its casualties, unless the winner had Advantage and the loser Disadvantage: then the winner
            chooses.
          </li>
          <li>
            <b>Shardstrike</b>: if a Shardbearer fired on doubles and its side wins, that side picks one of the casualties. In a
            Bloodbath it picks the enemy's one.
          </li>
          <li>
            <b>Retreat</b>: a defender that lost and still has cards may move the whole stack one hex for free, to a hex with no
            enemies, room for all of it, and no attacking hex next to it. It loses its Fortify. Retreating is optional.
          </li>
        </ul>
        <Example
          title="Overwhelming, with Shardstrike"
          atk={{
            label: `${K} attack`,
            cards: ['red-light-4', 'red-heavy-4', 'red-shardbearer-kaladin'],
            fire: ['red-light-4', 'red-heavy-4', 'red-shardbearer-kaladin'],
          }}
          def={{ label: `${S} defend`, cards: ['black-light-8', 'black-heavy-6', 'black-cavalry-leshwi'], fire: [] }}
          dice={<Dice a={2} b={2} />}
        >
          Both 4s fire, and Kaladin fires on the doubles: three activations against none. The {K} win and destroy two cards.
          Kaladin's Shardstrike lets the {K} pick one (Leshwi); the {S} choose the other.
        </Example>
      </>
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
  useEscapeTo('#/');

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
      <a className="back-link" href="#/" aria-label="Back" title="Back (Esc)">
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
