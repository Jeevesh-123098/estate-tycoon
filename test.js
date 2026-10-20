'use strict';
// Random-bot stress test of the game engine: checks invariants over many 2-8 player games.
const game = require('./game');

function rnd(n) { return Math.floor(Math.random() * n); }

function check(g, label) {
  let houses = 0, hotels = 0;
  g.props.forEach((o, i) => {
    if (!o) return;
    if (g.players[o.owner].bankrupt) throw new Error(label + ': bankrupt player owns property');
    if (o.houses === 5) hotels++; else houses += o.houses;
  });
  if (g.bank.houses !== 32 - houses) throw new Error(`${label}: house supply off ${g.bank.houses} vs ${32 - houses}`);
  if (g.bank.hotels !== 12 - hotels) throw new Error(`${label}: hotel supply off`);
  g.players.forEach((p) => {
    if (p.cash < 0) throw new Error(`${label}: negative cash ${p.cash} for ${p.name} phase=${g.phase}`);
    if (p.pos < 0 || p.pos > 39) throw new Error(label + ': bad position');
  });
  if (g.phase !== 'over' && g.players[g.turn].bankrupt) throw new Error(label + ': bankrupt player has the turn');
}

function botStep(g) {
  const n = g.players.length;
  const cur = g.turn;
  const tryAct = (pi, m) => game.act(g, pi, m);
  // Random side actions from random players
  if (Math.random() < 0.35) {
    const pi = rnd(n);
    const tile = rnd(40);
    const pick = ['build', 'sell', 'mortgage', 'unmortgage'][rnd(4)];
    tryAct(pi, { a: pick, tile });
  }
  if (Math.random() < 0.08) {
    const from = rnd(n), to = rnd(n);
    const mine = []; const theirs = [];
    g.props.forEach((o, i) => { if (o && o.owner === from && Math.random() < 0.4) mine.push(i); if (o && o.owner === to && Math.random() < 0.4) theirs.push(i); });
    tryAct(from, { a: 'trade', to, give: { cash: rnd(200), props: mine, cards: rnd(2) }, get: { cash: rnd(200), props: theirs, cards: rnd(2) } });
  }
  if (Math.random() < 0.15) {
    g.trades.slice().forEach((t) => { if (Math.random() < 0.7) tryAct(t.to, { a: 'tradeAccept', id: t.id }); else tryAct(t.to, { a: 'tradeCancel', id: t.id }); });
  }
  switch (g.phase) {
    case 'roll': {
      const p = g.players[cur];
      if (p.inJail && Math.random() < 0.3) tryAct(cur, { a: Math.random() < 0.5 ? 'payJail' : 'useCard' });
      return tryAct(cur, { a: 'roll' });
    }
    case 'buy': return tryAct(cur, { a: Math.random() < 0.7 ? 'buy' : 'decline' });
    case 'auction': {
      const c = g.auction.current;
      if (Math.random() < 0.5) return tryAct(c, { a: 'bid', amount: g.auction.bid + 1 + rnd(60) }) && tryAct(c, { a: 'pass' });
      return tryAct(c, { a: 'pass' });
    }
    case 'end': return tryAct(cur, { a: 'endTurn' });
    case 'debt': {
      // try raising money by selling / mortgaging, then pay, else bankrupt
      for (let i = 0; i < 40; i++) { game.act(g, cur, { a: 'sell', tile: i }); }
      for (let i = 0; i < 40; i++) { if (g.players[cur].cash >= g.debt.total) break; game.act(g, cur, { a: 'mortgage', tile: i }); }
      if (g.players[cur].cash >= g.debt.total) return tryAct(cur, { a: 'payDebt' });
      return tryAct(cur, { a: 'bankrupt' });
    }
    default: return null;
  }
}

let finished = 0, stuck = 0;
const GAMES = Number(process.argv[2]) || 300;
for (let k = 0; k < GAMES; k++) {
  const n = 2 + rnd(7);
  const g = game.createGame(Array.from({ length: n }, (_, i) => ({ name: 'P' + i, color: '#' + i })), 1500);
  let steps = 0;
  while (g.phase !== 'over' && steps < 30000) {
    botStep(g); check(g, `game ${k} step ${steps}`); steps++;
  }
  if (g.phase === 'over') finished++; else stuck++;
  game.snapshot(g); // must serialise
}
console.log(`games: ${GAMES}, finished: ${finished}, hit step cap: ${stuck}`);
if (finished === 0) { console.error('No game ever finished'); process.exit(1); }
console.log('engine OK');
