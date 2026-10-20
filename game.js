'use strict';
// Estate Tycoon - authoritative game engine (no I/O, pure state transitions)

const GM = {
  brown:  { c: '#955436', h: 50 },
  lblue:  { c: '#aae0fa', h: 50 },
  pink:   { c: '#d93a96', h: 100 },
  orange: { c: '#f7941d', h: 100 },
  red:    { c: '#ed1b24', h: 150 },
  yellow: { c: '#fef200', h: 150 },
  green:  { c: '#1fb25a', h: 200 },
  dblue:  { c: '#0072bb', h: 200 },
};
const P = (name, group, price, rent) => ({ type: 'prop', name, group, price, rent, hcost: GM[group].h, color: GM[group].c });
const R = (name) => ({ type: 'rail', name, price: 200 });
const U = (name) => ({ type: 'util', name, price: 150 });
const CH = { type: 'chance', name: 'Chance' };
const CF = { type: 'chest', name: 'Community Fund' };

const BOARD = [
  { type: 'go', name: 'START' },
  P('Old Bazaar Lane', 'brown', 60, [2, 10, 30, 90, 160, 250]),
  CF,
  P('Temple Street', 'brown', 60, [4, 20, 60, 180, 320, 450]),
  { type: 'tax', name: 'Income Tax', amount: 200 },
  R('North Station'),
  P('Lakeview Road', 'lblue', 100, [6, 30, 90, 270, 400, 550]),
  CH,
  P('Garden Avenue', 'lblue', 100, [6, 30, 90, 270, 400, 550]),
  P('Park Circle', 'lblue', 120, [8, 40, 100, 300, 450, 600]),
  { type: 'jail', name: 'Jail / Just Visiting' },
  P('Harbor Street', 'pink', 140, [10, 50, 150, 450, 625, 750]),
  U('Power Company'),
  P('Fort Road', 'pink', 140, [10, 50, 150, 450, 625, 750]),
  P('Palace Lane', 'pink', 160, [12, 60, 180, 500, 700, 900]),
  R('East Station'),
  P('Market Square', 'orange', 180, [14, 70, 200, 550, 750, 950]),
  CF,
  P('Clock Tower Road', 'orange', 180, [14, 70, 200, 550, 750, 950]),
  P('University Avenue', 'orange', 200, [16, 80, 220, 600, 800, 1000]),
  { type: 'parking', name: 'Free Parking' },
  P('Riverside Drive', 'red', 220, [18, 90, 250, 700, 875, 1050]),
  CH,
  P('Stadium Road', 'red', 220, [18, 90, 250, 700, 875, 1050]),
  P('Airport Way', 'red', 240, [20, 100, 300, 750, 925, 1100]),
  R('South Station'),
  P('Cinema Street', 'yellow', 260, [22, 110, 330, 800, 975, 1150]),
  P('Museum Mile', 'yellow', 260, [22, 110, 330, 800, 975, 1150]),
  U('Water Works'),
  P('Opera Plaza', 'yellow', 280, [24, 120, 360, 850, 1025, 1200]),
  { type: 'gotojail', name: 'Go To Jail' },
  P('Hilltop Avenue', 'green', 300, [26, 130, 390, 900, 1100, 1275]),
  P('Orchid Gardens', 'green', 300, [26, 130, 390, 900, 1100, 1275]),
  CF,
  P('Skyline Boulevard', 'green', 320, [28, 150, 450, 1000, 1200, 1400]),
  R('West Station'),
  CH,
  P('Maharaja Road', 'dblue', 350, [35, 175, 500, 1100, 1300, 1500]),
  { type: 'tax', name: 'Luxury Tax', amount: 100 },
  P('Crown Heights', 'dblue', 400, [50, 200, 600, 1400, 1700, 2000]),
];

const GROUPS = {};
BOARD.forEach((t, i) => { if (t.type === 'prop') (GROUPS[t.group] = GROUPS[t.group] || []).push(i); });
const RAILS = [5, 15, 25, 35];
const UTILS = [12, 28];
const JAIL_POS = 10;
const JAIL_FEE = 50;

const CHANCE = [
  { fx: 'moveTo', to: 0, text: 'Advance to START. Collect $200.' },
  { fx: 'moveTo', to: 24, text: 'Advance to Airport Way. If you pass START, collect $200.' },
  { fx: 'moveTo', to: 11, text: 'Advance to Harbor Street. If you pass START, collect $200.' },
  { fx: 'moveTo', to: 39, text: 'Take a stroll to Crown Heights.' },
  { fx: 'moveTo', to: 5, text: 'Take a trip to North Station. If you pass START, collect $200.' },
  { fx: 'nearRail', text: 'Advance to the nearest station. If owned, pay the owner double rent.' },
  { fx: 'nearRail', text: 'Advance to the nearest station. If owned, pay the owner double rent.' },
  { fx: 'nearUtil', text: 'Advance to the nearest utility. If owned, roll the dice and pay 10x the roll.' },
  { fx: 'gain', amt: 50, text: 'The bank pays you a dividend of $50.' },
  { fx: 'gain', amt: 150, text: 'Your building loan matures. Collect $150.' },
  { fx: 'jailcard', text: 'Get Out of Jail Free. Keep this card until needed.' },
  { fx: 'back3', text: 'Go back 3 spaces.' },
  { fx: 'jail', text: 'Go directly to Jail. Do not pass START.' },
  { fx: 'repairs', house: 25, hotel: 100, text: 'General repairs on all your property: $25 per house, $100 per hotel.' },
  { fx: 'pay', amt: 15, text: 'Speeding fine. Pay $15.' },
  { fx: 'payAll', amt: 50, text: 'You are elected chairman. Pay each player $50.' },
];
const CHEST = [
  { fx: 'moveTo', to: 0, text: 'Advance to START. Collect $200.' },
  { fx: 'gain', amt: 200, text: 'Bank error in your favour. Collect $200.' },
  { fx: 'pay', amt: 50, text: "Doctor's fee. Pay $50." },
  { fx: 'gain', amt: 50, text: 'You sell some stock. Collect $50.' },
  { fx: 'jailcard', text: 'Get Out of Jail Free. Keep this card until needed.' },
  { fx: 'jail', text: 'Go directly to Jail. Do not pass START.' },
  { fx: 'gain', amt: 100, text: 'Holiday fund matures. Collect $100.' },
  { fx: 'gain', amt: 20, text: 'Tax refund. Collect $20.' },
  { fx: 'collectAll', amt: 10, text: "It's your birthday. Collect $10 from every player." },
  { fx: 'gain', amt: 100, text: 'Life insurance matures. Collect $100.' },
  { fx: 'pay', amt: 100, text: 'Hospital fees. Pay $100.' },
  { fx: 'pay', amt: 50, text: 'School fees. Pay $50.' },
  { fx: 'gain', amt: 25, text: 'Receive a $25 consultancy fee.' },
  { fx: 'repairs', house: 40, hotel: 115, text: 'Street repairs: $40 per house, $115 per hotel.' },
  { fx: 'gain', amt: 10, text: 'You win second prize in a beauty contest. Collect $10.' },
  { fx: 'gain', amt: 100, text: 'You inherit $100.' },
];
const JAILCARD = {
  chance: CHANCE.find((c) => c.fx === 'jailcard'),
  chest: CHEST.find((c) => c.fx === 'jailcard'),
};

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function log(g, text) {
  g.log.push(text);
  if (g.log.length > 120) g.log.shift();
}

function createGame(seats, startCash) {
  const g = {
    players: seats.map((s) => ({
      name: s.name, color: s.color, pos: 0, cash: startCash || 1500, inJail: false, jailTurns: 0,
      jailCards: [], doublesCount: 0, bankrupt: false,
    })),
    props: Array(40).fill(null),
    bank: { houses: 32, hotels: 12 },
    turn: Math.floor(Math.random() * seats.length),
    phase: 'roll',
    dice: null,
    rollSeq: 0,
    doubles: false,
    buyTile: null,
    auction: null,
    debt: null,
    afterDebt: null,
    trades: [],
    nextTradeId: 1,
    decks: { chance: shuffle(CHANCE.slice()), chest: shuffle(CHEST.slice()) },
    log: [],
    lastCard: null,
    cardSeq: 0,
    winner: null,
  };
  log(g, `Game started! ${g.players[g.turn].name} goes first.`);
  return g;
}

/* ---------- helpers ---------- */
const money = (n) => '$' + n;
const alive = (g) => g.players.filter((p) => !p.bankrupt);

function hasMonopoly(g, pi, group) {
  return GROUPS[group].every((i) => g.props[i] && g.props[i].owner === pi);
}
function countOwned(g, pi, list) {
  return list.filter((i) => g.props[i] && g.props[i].owner === pi).length;
}
function rentFor(g, idx, diceTotal, opts) {
  opts = opts || {};
  const t = BOARD[idx], o = g.props[idx];
  if (!o || o.mortgaged) return 0;
  if (t.type === 'prop') {
    if (o.houses > 0) return t.rent[o.houses];
    return hasMonopoly(g, o.owner, t.group) ? t.rent[0] * 2 : t.rent[0];
  }
  if (t.type === 'rail') {
    const n = countOwned(g, o.owner, RAILS);
    return 25 * Math.pow(2, n - 1) * (opts.railMult || 1);
  }
  if (t.type === 'util') {
    const n = countOwned(g, o.owner, UTILS);
    const mult = opts.utilTen ? 10 : (n >= 2 ? 10 : 4);
    return mult * diceTotal;
  }
  return 0;
}
function worth(g, pi) {
  let w = g.players[pi].cash;
  g.props.forEach((o, i) => {
    if (o && o.owner === pi) {
      const t = BOARD[i];
      w += o.mortgaged ? Math.floor(t.price / 2) : t.price;
      if (t.hcost) w += o.houses * t.hcost;
    }
  });
  return w;
}

/* ---------- money flow ---------- */
function charge(g, pi, payees, after) {
  const p = g.players[pi];
  const total = payees.reduce((s, x) => s + x.amt, 0);
  if (p.cash >= total) {
    payees.forEach((x) => { p.cash -= x.amt; if (x.to !== null) g.players[x.to].cash += x.amt; });
    return true;
  }
  g.debt = { player: pi, payees, total };
  g.afterDebt = after || { type: 'finish' };
  g.phase = 'debt';
  log(g, `${p.name} owes ${money(total)} but only has ${money(p.cash)} - must raise cash or go bankrupt.`);
  return false;
}

function finish(g) {
  if (g.phase === 'over') return;
  const p = g.players[g.turn];
  g.phase = (g.doubles && !p.inJail && !p.bankrupt) ? 'roll' : 'end';
}

function nextTurn(g) {
  const prev = g.players[g.turn];
  if (prev) prev.doublesCount = 0;
  let n = g.turn;
  do { n = (n + 1) % g.players.length; } while (g.players[n].bankrupt);
  g.turn = n;
  g.phase = 'roll';
  g.doubles = false;
  g.buyTile = null;
  g.debt = null;
  g.afterDebt = null;
  g.auction = null;
  log(g, `${g.players[n].name}'s turn.`);
}

/* ---------- movement & landing ---------- */
function moveBy(g, pi, steps) {
  const p = g.players[pi];
  const np = p.pos + steps;
  if (np >= 40) { p.cash += 200; log(g, `${p.name} passes START and collects $200.`); }
  p.pos = np % 40;
  land(g, pi, {});
}
function moveTo(g, pi, to, opts) {
  const p = g.players[pi];
  if (to < p.pos) { p.cash += 200; log(g, `${p.name} passes START and collects $200.`); }
  p.pos = to;
  land(g, pi, opts || {});
}
function sendToJail(g, pi) {
  const p = g.players[pi];
  p.pos = JAIL_POS; p.inJail = true; p.jailTurns = 0; p.doublesCount = 0;
  g.doubles = false;
  log(g, `${p.name} goes to Jail.`);
  finish(g);
}

function land(g, pi, opts) {
  const p = g.players[pi];
  const t = BOARD[p.pos];
  log(g, `${p.name} lands on ${t.name}.`);
  switch (t.type) {
    case 'prop': case 'rail': case 'util': {
      const o = g.props[p.pos];
      if (!o) { g.phase = 'buy'; g.buyTile = p.pos; return; }
      if (o.owner === pi) return finish(g);
      if (o.mortgaged) { log(g, `${t.name} is mortgaged - no rent.`); return finish(g); }
      const total = g.dice ? g.dice[0] + g.dice[1] : 7;
      const rent = rentFor(g, p.pos, total, opts);
      log(g, `${p.name} pays ${money(rent)} rent to ${g.players[o.owner].name}.`);
      if (charge(g, pi, [{ to: o.owner, amt: rent }], { type: 'finish' })) finish(g);
      return;
    }
    case 'tax':
      log(g, `${p.name} pays ${money(t.amount)} in tax.`);
      if (charge(g, pi, [{ to: null, amt: t.amount }], { type: 'finish' })) finish(g);
      return;
    case 'chance': return drawCard(g, pi, 'chance');
    case 'chest': return drawCard(g, pi, 'chest');
    case 'gotojail': return sendToJail(g, pi);
    default: return finish(g);
  }
}

function drawCard(g, pi, deckName) {
  const p = g.players[pi];
  const deck = g.decks[deckName];
  const card = deck.shift();
  if (card.fx === 'jailcard') p.jailCards.push(deckName); else deck.push(card);
  g.cardSeq++;
  g.lastCard = { seq: g.cardSeq, deck: deckName, text: card.text, player: p.name };
  log(g, `${deckName === 'chance' ? 'Chance' : 'Community Fund'} (${p.name}): ${card.text}`);
  switch (card.fx) {
    case 'moveTo': return moveTo(g, pi, card.to, {});
    case 'nearRail': {
      const to = RAILS.find((r) => r > p.pos) ?? RAILS[0];
      return moveTo(g, pi, to, { railMult: 2 });
    }
    case 'nearUtil': {
      const to = UTILS.find((r) => r > p.pos) ?? UTILS[0];
      return moveTo(g, pi, to, { utilTen: true });
    }
    case 'gain': p.cash += card.amt; return finish(g);
    case 'pay':
      if (charge(g, pi, [{ to: null, amt: card.amt }], { type: 'finish' })) finish(g);
      return;
    case 'back3': p.pos = (p.pos + 37) % 40; return land(g, pi, {});
    case 'jail': return sendToJail(g, pi);
    case 'jailcard': return finish(g);
    case 'repairs': {
      let amt = 0;
      g.props.forEach((o, i) => {
        if (o && o.owner === pi && BOARD[i].type === 'prop') amt += o.houses === 5 ? card.hotel : o.houses * card.house;
      });
      if (amt === 0) return finish(g);
      if (charge(g, pi, [{ to: null, amt }], { type: 'finish' })) finish(g);
      return;
    }
    case 'payAll': {
      const payees = g.players.map((q, i) => ({ to: i, amt: card.amt })).filter((x) => x.to !== pi && !g.players[x.to].bankrupt);
      if (charge(g, pi, payees, { type: 'finish' })) finish(g);
      return;
    }
    case 'collectAll':
      g.players.forEach((q, i) => {
        if (i === pi || q.bankrupt) return;
        const amt = Math.min(q.cash, card.amt);
        q.cash -= amt; p.cash += amt;
      });
      return finish(g);
    default: return finish(g);
  }
}

/* ---------- rolling ---------- */
function doRoll(g, pi) {
  const p = g.players[pi];
  const d1 = 1 + Math.floor(Math.random() * 6), d2 = 1 + Math.floor(Math.random() * 6);
  g.dice = [d1, d2]; g.rollSeq++;
  const tot = d1 + d2, dbl = d1 === d2;
  log(g, `${p.name} rolled ${d1} + ${d2}${dbl ? ' (doubles!)' : ''}.`);
  if (p.inJail) {
    g.doubles = false;
    if (dbl) {
      p.inJail = false; p.jailTurns = 0;
      log(g, `${p.name} rolled doubles and leaves Jail.`);
      return moveBy(g, pi, tot);
    }
    p.jailTurns++;
    if (p.jailTurns >= 3) {
      log(g, `${p.name} must pay ${money(JAIL_FEE)} to leave Jail.`);
      if (charge(g, pi, [{ to: null, amt: JAIL_FEE }], { type: 'move', steps: tot })) {
        p.inJail = false; p.jailTurns = 0;
        return moveBy(g, pi, tot);
      }
      return;
    }
    log(g, `${p.name} stays in Jail.`);
    g.phase = 'end';
    return;
  }
  g.doubles = dbl;
  if (dbl) {
    p.doublesCount++;
    if (p.doublesCount >= 3) { log(g, `${p.name} rolled three doubles in a row!`); return sendToJail(g, pi); }
  } else p.doublesCount = 0;
  moveBy(g, pi, tot);
}

/* ---------- auctions ---------- */
function startAuction(g) {
  const order = [];
  for (let k = 0; k < g.players.length; k++) {
    const i = (g.turn + k) % g.players.length;
    if (!g.players[i].bankrupt) order.push(i);
  }
  g.auction = { tile: g.buyTile, bid: 0, bidder: null, active: order, i: 0, current: order[0] };
  g.phase = 'auction';
  log(g, `Auction started for ${BOARD[g.buyTile].name}.`);
  g.buyTile = null;
}
function auctionEnd(g) {
  const a = g.auction;
  if (a.bidder !== null) {
    g.players[a.bidder].cash -= a.bid;
    g.props[a.tile] = { owner: a.bidder, houses: 0, mortgaged: false };
    log(g, `${g.players[a.bidder].name} wins ${BOARD[a.tile].name} for ${money(a.bid)}.`);
  } else log(g, `No bids - ${BOARD[a.tile].name} stays with the bank.`);
  g.auction = null;
  finish(g);
}

/* ---------- bankruptcy ---------- */
function bankrupt(g, pi, creditor) {
  const p = g.players[pi];
  if (p.bankrupt) return;
  let gain = 0;
  for (let i = 0; i < 40; i++) {
    const o = g.props[i];
    if (!o || o.owner !== pi) continue;
    if (o.houses) {
      if (o.houses === 5) g.bank.hotels++; else g.bank.houses += o.houses;
      gain += Math.floor(BOARD[i].hcost / 2) * o.houses;
      o.houses = 0;
    }
    if (creditor !== null && creditor !== undefined) o.owner = creditor; else g.props[i] = null;
  }
  if (creditor !== null && creditor !== undefined) {
    g.players[creditor].cash += p.cash + gain;
    p.jailCards.forEach((c) => g.players[creditor].jailCards.push(c));
  } else {
    p.jailCards.forEach((c) => g.decks[c].push(JAILCARD[c]));
  }
  p.jailCards = []; p.cash = 0; p.bankrupt = true; p.inJail = false;
  g.trades = g.trades.filter((t) => t.from !== pi && t.to !== pi);
  log(g, `${p.name} is bankrupt${creditor !== null && creditor !== undefined ? ` - assets go to ${g.players[creditor].name}` : ''}.`);
  const left = alive(g);
  if (left.length <= 1) {
    g.phase = 'over';
    g.winner = left.length ? g.players.indexOf(left[0]) : null;
    g.debt = null; g.auction = null; g.buyTile = null;
    if (left.length) log(g, `${left[0].name} wins the game!`);
    return;
  }
  if (g.turn === pi) nextTurn(g);
  else if (g.debt && g.debt.player === pi) { g.debt = null; }
}

// Used by host-kick and voluntary leave.
function forfeit(g, pi) {
  if (g.phase === 'over' || g.players[pi].bankrupt) return null;
  if (g.phase === 'auction') {
    if (g.auction.current !== pi) {
      if (g.auction.bidder === pi || g.auction.active.includes(pi)) return 'Wait until the current auction finishes.';
    } else act(g, pi, { a: 'pass' });
  }
  if (g.phase === 'over') return null;
  bankrupt(g, pi, null);
  return null;
}

/* ---------- trades ---------- */
function cleanSide(s) {
  s = s || {};
  const cash = Number.isInteger(s.cash) ? Math.max(0, s.cash) : 0;
  const cards = Number.isInteger(s.cards) ? Math.max(0, s.cards) : 0;
  const props = Array.isArray(s.props) ? [...new Set(s.props.filter((x) => Number.isInteger(x)))] : [];
  return { cash, cards, props };
}
function groupHasBuildings(g, idx) {
  const t = BOARD[idx];
  if (t.type !== 'prop') return false;
  return GROUPS[t.group].some((j) => g.props[j] && g.props[j].houses > 0);
}
function checkTrade(g, t) {
  const A = g.players[t.from], B = g.players[t.to];
  if (!A || !B || A.bankrupt || B.bankrupt || t.from === t.to) return 'Invalid trade partner';
  const sides = [[t.from, t.give, A], [t.to, t.get, B]];
  let empty = true;
  for (const [pi, side, pl] of sides) {
    if (side.cash > pl.cash) return `${pl.name} doesn't have that much cash`;
    if (side.cards > pl.jailCards.length) return `${pl.name} doesn't have that many Jail cards`;
    for (const i of side.props) {
      const o = g.props[i];
      if (!BOARD[i] || !o || o.owner !== pi) return 'A property in the offer is not owned by the right player';
      if (groupHasBuildings(g, i)) return 'Sell buildings in a colour set before trading it';
    }
    if (side.cash || side.cards || side.props.length) empty = false;
  }
  if (empty) return 'Empty trade';
  const interest = (list) => list.reduce((s, i) => s + (g.props[i].mortgaged ? Math.ceil(BOARD[i].price * 0.05) : 0), 0);
  if (A.cash - t.give.cash + t.get.cash - interest(t.get.props) < 0) return `${A.name} can't afford the mortgage fee`;
  if (B.cash - t.get.cash + t.give.cash - interest(t.give.props) < 0) return `${B.name} can't afford the mortgage fee`;
  return null;
}
function execTrade(g, t) {
  const A = g.players[t.from], B = g.players[t.to];
  A.cash += t.get.cash - t.give.cash;
  B.cash += t.give.cash - t.get.cash;
  const move = (list, newOwner, receiver) => list.forEach((i) => {
    g.props[i].owner = newOwner;
    if (g.props[i].mortgaged) receiver.cash -= Math.ceil(BOARD[i].price * 0.05);
  });
  move(t.give.props, t.to, B);
  move(t.get.props, t.from, A);
  for (let k = 0; k < t.give.cards; k++) B.jailCards.push(A.jailCards.pop());
  for (let k = 0; k < t.get.cards; k++) A.jailCards.push(B.jailCards.pop());
  g.trades = g.trades.filter((x) => x.from !== t.from && x.to !== t.from && x.from !== t.to && x.to !== t.to);
  log(g, `${A.name} and ${B.name} completed a trade.`);
}

/* ---------- player actions ---------- */
function act(g, pi, m) {
  const p = g.players[pi];
  if (!p) return 'Unknown player';
  if (p.bankrupt) return 'You are out of the game';
  if (g.phase === 'over') return 'The game is over';
  const ph = g.phase, mine = g.turn === pi;
  const canManage = ph === 'roll' || ph === 'end' || (ph === 'debt' && g.debt.player === pi);
  const tile = Number.isInteger(m.tile) ? m.tile : -1;
  const t = BOARD[tile], o = g.props[tile];

  switch (m.a) {
    case 'roll':
      if (!mine || ph !== 'roll') return "You can't roll right now";
      doRoll(g, pi); return null;

    case 'payJail':
      if (!mine || ph !== 'roll' || !p.inJail) return "You're not in Jail";
      if (p.cash < JAIL_FEE) return 'Not enough cash';
      p.cash -= JAIL_FEE; p.inJail = false; p.jailTurns = 0;
      log(g, `${p.name} pays ${money(JAIL_FEE)} and leaves Jail.`); return null;

    case 'useCard': {
      if (!mine || ph !== 'roll' || !p.inJail || !p.jailCards.length) return 'No card to use';
      const d = p.jailCards.pop(); g.decks[d].push(JAILCARD[d]);
      p.inJail = false; p.jailTurns = 0;
      log(g, `${p.name} uses a Get Out of Jail Free card.`); return null;
    }

    case 'buy': {
      if (!mine || ph !== 'buy') return 'Nothing to buy';
      const bt = BOARD[g.buyTile];
      if (p.cash < bt.price) return 'Not enough cash';
      p.cash -= bt.price;
      g.props[g.buyTile] = { owner: pi, houses: 0, mortgaged: false };
      log(g, `${p.name} buys ${bt.name} for ${money(bt.price)}.`);
      g.buyTile = null; finish(g); return null;
    }
    case 'decline':
      if (!mine || ph !== 'buy') return 'Nothing to auction';
      startAuction(g); return null;

    case 'bid': {
      if (ph !== 'auction' || g.auction.current !== pi) return "It's not your turn to bid";
      const a = g.auction, amt = m.amount;
      if (!Number.isInteger(amt) || amt <= a.bid) return 'Bid must be higher than the current bid';
      if (amt > p.cash) return 'Not enough cash';
      a.bid = amt; a.bidder = pi;
      log(g, `${p.name} bids ${money(amt)}.`);
      a.i = (a.i + 1) % a.active.length; a.current = a.active[a.i];
      if (a.current === a.bidder) auctionEnd(g);
      return null;
    }
    case 'pass': {
      if (ph !== 'auction' || g.auction.current !== pi) return "It's not your turn to bid";
      const a = g.auction;
      log(g, `${p.name} passes.`);
      a.active.splice(a.i, 1);
      if (!a.active.length) { auctionEnd(g); return null; }
      if (a.i >= a.active.length) a.i = 0;
      a.current = a.active[a.i];
      if (a.bidder !== null && a.current === a.bidder) auctionEnd(g);
      return null;
    }

    case 'endTurn':
      if (!mine || ph !== 'end') return "You can't end your turn yet";
      nextTurn(g); return null;

    case 'build': {
      if (!(ph === 'roll' || ph === 'end')) return "You can't build right now";
      if (!t || t.type !== 'prop' || !o || o.owner !== pi) return 'Not your property';
      if (!hasMonopoly(g, pi, t.group)) return 'You need the whole colour set to build';
      const grp = GROUPS[t.group];
      if (grp.some((j) => g.props[j].mortgaged)) return 'Unmortgage the whole set first';
      if (o.houses >= 5) return 'Already has a hotel';
      if (o.houses > Math.min(...grp.map((j) => g.props[j].houses))) return 'Build evenly across the set';
      if (p.cash < t.hcost) return 'Not enough cash';
      if (o.houses === 4) {
        if (g.bank.hotels < 1) return 'No hotels left in the bank';
        g.bank.hotels--; g.bank.houses += 4;
      } else {
        if (g.bank.houses < 1) return 'No houses left in the bank';
        g.bank.houses--;
      }
      o.houses++; p.cash -= t.hcost;
      log(g, `${p.name} builds a ${o.houses === 5 ? 'hotel' : 'house'} on ${t.name}.`); return null;
    }
    case 'sell': {
      if (!canManage) return "You can't sell right now";
      if (!t || t.type !== 'prop' || !o || o.owner !== pi) return 'Not your property';
      if (o.houses < 1) return 'No buildings to sell';
      if (o.houses < Math.max(...GROUPS[t.group].map((j) => g.props[j].houses))) return 'Sell evenly across the set';
      if (o.houses === 5) {
        if (g.bank.houses < 4) return 'Not enough houses in the bank to replace the hotel';
        g.bank.houses -= 4; g.bank.hotels++;
      } else g.bank.houses++;
      o.houses--; p.cash += Math.floor(t.hcost / 2);
      log(g, `${p.name} sells a building on ${t.name}.`); return null;
    }
    case 'mortgage': {
      if (!canManage) return "You can't mortgage right now";
      if (!t || !t.price || !o || o.owner !== pi) return 'Not your property';
      if (o.mortgaged) return 'Already mortgaged';
      if (groupHasBuildings(g, tile)) return 'Sell all buildings in this colour set first';
      o.mortgaged = true; p.cash += Math.floor(t.price / 2);
      log(g, `${p.name} mortgages ${t.name}.`); return null;
    }
    case 'unmortgage': {
      if (!(ph === 'roll' || ph === 'end')) return "You can't do that right now";
      if (!t || !t.price || !o || o.owner !== pi) return 'Not your property';
      if (!o.mortgaged) return 'Not mortgaged';
      const cost = Math.ceil(t.price / 2 * 1.1);
      if (p.cash < cost) return `Need ${money(cost)} to unmortgage`;
      p.cash -= cost; o.mortgaged = false;
      log(g, `${p.name} pays off the mortgage on ${t.name}.`); return null;
    }

    case 'payDebt': {
      if (ph !== 'debt' || g.debt.player !== pi) return 'You owe nothing';
      const d = g.debt;
      if (p.cash < d.total) return `You still need ${money(d.total - p.cash)}`;
      d.payees.forEach((x) => { p.cash -= x.amt; if (x.to !== null) g.players[x.to].cash += x.amt; });
      const af = g.afterDebt;
      g.debt = null; g.afterDebt = null; g.phase = 'end';
      log(g, `${p.name} settles the debt.`);
      if (af && af.type === 'move') { p.inJail = false; p.jailTurns = 0; moveBy(g, pi, af.steps); } else finish(g);
      return null;
    }
    case 'bankrupt': {
      if (ph !== 'debt' || g.debt.player !== pi) return "You can't declare bankruptcy right now";
      const pay = g.debt.payees;
      bankrupt(g, pi, pay.length === 1 && pay[0].to !== null ? pay[0].to : null);
      return null;
    }

    case 'trade': {
      if (ph === 'auction' || ph === 'buy') return "Can't trade during a purchase or auction";
      const tr = { id: g.nextTradeId++, from: pi, to: m.to, give: cleanSide(m.give), get: cleanSide(m.get) };
      const err = checkTrade(g, tr);
      if (err) return err;
      g.trades = g.trades.filter((x) => x.from !== pi);
      g.trades.push(tr);
      log(g, `${p.name} offers a trade to ${g.players[tr.to].name}.`);
      return null;
    }
    case 'tradeAccept': {
      if (ph === 'auction' || ph === 'buy') return "Can't trade during a purchase or auction";
      const tr = g.trades.find((x) => x.id === m.id && x.to === pi);
      if (!tr) return 'That offer is no longer available';
      const err = checkTrade(g, tr);
      if (err) { g.trades = g.trades.filter((x) => x !== tr); return err; }
      execTrade(g, tr); return null;
    }
    case 'tradeCancel': {
      const tr = g.trades.find((x) => x.id === m.id && (x.to === pi || x.from === pi));
      if (!tr) return 'That offer is no longer available';
      g.trades = g.trades.filter((x) => x !== tr);
      log(g, tr.from === pi ? `${p.name} withdrew a trade offer.` : `${p.name} declined a trade offer.`);
      return null;
    }
    default: return 'Unknown action';
  }
}

function snapshot(g) {
  const s = JSON.parse(JSON.stringify(g, (k, v) => (k === 'decks' ? undefined : v)));
  s.players.forEach((p, i) => { p.worth = worth(g, i); });
  return s;
}

module.exports = { BOARD, GROUPS, GM, createGame, act, forfeit, snapshot, worth, bankrupt, JAIL_FEE };
