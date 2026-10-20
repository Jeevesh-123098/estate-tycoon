'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const game = require('./game');

const PORT = process.env.PORT || 3000;
const MAX_SEATS = 8;
const IDLE_AUTOPLAY_MS = 45000;
const COLORS = ['#e63946', '#1d7ae0', '#2bb673', '#f4a300', '#9b59b6', '#00b8c4', '#ff6fb1', '#7a7a7a'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const rooms = new Map();

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(500); return res.end('index.html missing'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  } else if (u === '/healthz') {
    res.writeHead(200); res.end('ok');
  } else {
    res.writeHead(404); res.end('Not found');
  }
});
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const clean = (s, n) => String(s == null ? '' : s).replace(/[<>&"'`]/g, '').trim().slice(0, n);

function makeCode() {
  for (let tries = 0; tries < 200; tries++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('no room codes');
}
const newToken = () => crypto.randomBytes(16).toString('hex');

function freeColor(room, want) {
  const used = new Set(room.seats.map((s) => s.color));
  if (want && COLORS.includes(want) && !used.has(want)) return want;
  return COLORS.find((c) => !used.has(c));
}

function roomInfo(room) {
  return {
    type: 'room',
    code: room.code,
    host: room.seats.findIndex((s) => s.token === room.hostToken),
    started: room.started,
    colors: COLORS,
    seats: room.seats.map((s) => ({ name: s.name, color: s.color, connected: !!s.ws })),
  };
}
function broadcast(room, obj) { room.seats.forEach((s) => send(s.ws, obj)); }
function pushRoom(room) { broadcast(room, roomInfo(room)); }
function pushState(room) {
  if (!room.g) return;
  room.g.players.forEach((p, i) => { p.connected = !!room.seats[i].ws; });
  broadcast(room, { type: 'state', g: game.snapshot(room.g) });
}
function joinedMsg(room, seatIdx) {
  return { type: 'joined', code: room.code, token: room.seats[seatIdx].token, you: seatIdx, board: game.BOARD, groupMeta: game.GM };
}
function attach(room, seatIdx, ws) {
  const seat = room.seats[seatIdx];
  if (seat.ws && seat.ws !== ws) { try { seat.ws.ctx = null; seat.ws.close(); } catch (e) { /* ignore */ } }
  seat.ws = ws; seat.discAt = null;
  ws.ctx = { room, token: seat.token };
  send(ws, joinedMsg(room, seatIdx));
  send(ws, { type: 'chatlog', msgs: room.chat });
  pushRoom(room);
  pushState(room);
}
const seatIndex = (ws) => (ws.ctx ? ws.ctx.room.seats.findIndex((s) => s.token === ws.ctx.token) : -1);

function removeSeatInLobby(room, idx) {
  const [seat] = room.seats.splice(idx, 1);
  if (seat.ws) { seat.ws.ctx = null; send(seat.ws, { type: 'error', msg: 'You left the room.', fatal: true }); }
  if (!room.seats.length) { rooms.delete(room.code); return; }
  if (seat.token === room.hostToken) room.hostToken = room.seats[0].token;
  room.seats.forEach((s) => { if (s.ws) send(s.ws, joinedMsg(room, room.seats.indexOf(s))); });
  pushRoom(room);
}

// Disconnected players must never stall a game.
function autoplay(room) {
  const g = room.g;
  if (!g) return false;
  let changed = false;
  for (let n = 0; n < 40 && g.phase !== 'over'; n++) {
    let pi, a, idle = false;
    if (g.phase === 'auction') { pi = g.auction.current; a = { a: 'pass' }; }
    else if (g.phase === 'buy') { pi = g.turn; a = { a: 'decline' }; }
    else if (g.phase === 'debt') { pi = g.turn; a = { a: 'bankrupt' }; }
    else if (g.phase === 'roll') { pi = g.turn; a = { a: 'roll' }; idle = true; }
    else { pi = g.turn; a = { a: 'endTurn' }; idle = true; }
    const seat = room.seats[pi];
    if (!seat || seat.ws) break;
    if (idle && seat.discAt && Date.now() - seat.discAt < IDLE_AUTOPLAY_MS) break;
    if (game.act(g, pi, a)) break;
    changed = true;
  }
  return changed;
}

function handle(ws, m) {
  if (!m || typeof m.type !== 'string') return;

  if (m.type === 'create') {
    const code = makeCode();
    const token = newToken();
    const room = { code, hostToken: token, started: false, g: null, chat: [], seats: [], created: Date.now(), startCash: 1500 };
    room.seats.push({ token, name: clean(m.name, 16) || 'Player 1', color: COLORS[0], ws: null, discAt: null });
    rooms.set(code, room);
    attach(room, 0, ws);
    return;
  }
  if (m.type === 'join') {
    const room = rooms.get(clean(m.code, 4).toUpperCase());
    if (!room) return send(ws, { type: 'error', msg: 'Room not found. Check the code.' });
    if (room.started) return send(ws, { type: 'error', msg: 'That game has already started.' });
    if (room.seats.length >= MAX_SEATS) return send(ws, { type: 'error', msg: 'Room is full (8 players max).' });
    const token = newToken();
    room.seats.push({ token, name: clean(m.name, 16) || `Player ${room.seats.length + 1}`, color: freeColor(room), ws: null, discAt: null });
    attach(room, room.seats.length - 1, ws);
    return;
  }
  if (m.type === 'rejoin') {
    const room = rooms.get(clean(m.code, 4).toUpperCase());
    const idx = room ? room.seats.findIndex((s) => s.token && s.token === m.token) : -1;
    if (idx < 0) return send(ws, { type: 'error', msg: 'Session expired.', fatal: true });
    attach(room, idx, ws);
    return;
  }

  const room = ws.ctx && ws.ctx.room;
  const me = seatIndex(ws);
  if (!room || me < 0) return;
  const isHost = room.seats[me].token === room.hostToken;

  switch (m.type) {
    case 'setColor':
      if (room.started) return;
      if (!COLORS.includes(m.color) || room.seats.some((s) => s.color === m.color)) return;
      room.seats[me].color = m.color; pushRoom(room); break;

    case 'start':
      if (!isHost || room.started) return;
      if (room.seats.length < 2) return send(ws, { type: 'error', msg: 'Need at least 2 players to start.' });
      room.started = true;
      room.g = game.createGame(room.seats, room.startCash);
      pushRoom(room); pushState(room);
      break;

    case 'action': {
      if (!room.started || !room.g) return;
      const err = game.act(room.g, me, m);
      if (err) return send(ws, { type: 'error', msg: err });
      autoplay(room);
      pushState(room);
      break;
    }
    case 'chat': {
      const text = clean(m.text, 200);
      if (!text) return;
      const msg = { type: 'chat', name: room.seats[me].name, color: room.seats[me].color, text };
      room.chat.push(msg); if (room.chat.length > 60) room.chat.shift();
      broadcast(room, msg);
      break;
    }
    case 'kick': {
      if (!isHost || !Number.isInteger(m.seat) || m.seat === me || !room.seats[m.seat]) return;
      if (!room.started) { removeSeatInLobby(room, m.seat); break; }
      const err = game.forfeit(room.g, m.seat);
      if (err) return send(ws, { type: 'error', msg: err });
      const s = room.seats[m.seat];
      if (s.ws) { send(s.ws, { type: 'error', msg: 'You were removed by the host.', fatal: true }); s.ws.ctx = null; }
      s.token = null; s.ws = null;
      autoplay(room); pushRoom(room); pushState(room);
      break;
    }
    case 'leave': {
      if (!room.started) { removeSeatInLobby(room, me); break; }
      game.forfeit(room.g, me);
      const s = room.seats[me];
      s.token = null; s.ws = null; ws.ctx = null;
      send(ws, { type: 'error', msg: 'You left the game.', fatal: true });
      autoplay(room); pushRoom(room); pushState(room);
      break;
    }
    default: break;
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    try { handle(ws, m); } catch (e) { console.error('handler error', e); send(ws, { type: 'error', msg: 'Server error.' }); }
  });
  ws.on('close', () => {
    const ctx = ws.ctx;
    if (!ctx) return;
    const seat = ctx.room.seats.find((s) => s.token === ctx.token);
    if (!seat || seat.ws !== ws) return;
    seat.ws = null; seat.discAt = Date.now();
    if (autoplay(ctx.room)) pushState(ctx.room);
    pushRoom(ctx.room);
    if (ctx.room.g) pushState(ctx.room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    // heartbeat
    room.seats.forEach((s) => { if (s.ws && s.ws.isAlive === false) { try { s.ws.terminate(); } catch (e) { /* ignore */ } } });
    room.seats.forEach((s) => { if (s.ws) { s.ws.isAlive = false; try { s.ws.ping(); } catch (e) { /* ignore */ } } });
    // lobby seats that vanished
    if (!room.started) {
      for (let i = room.seats.length - 1; i >= 0; i--) {
        const s = room.seats[i];
        if (!s.ws && s.discAt && now - s.discAt > 30000 && rooms.has(code)) removeSeatInLobby(room, i);
      }
      if (!rooms.has(code)) continue;
    } else if (autoplay(room)) pushState(room);
    const anyone = room.seats.some((s) => s.ws);
    const lastSeen = Math.max(0, ...room.seats.map((s) => s.discAt || 0));
    if (!anyone && now - Math.max(lastSeen, room.created) > 2 * 3600 * 1000) rooms.delete(code);
  }
}, 5000);

if (require.main === module) {
  server.listen(PORT, () => console.log(`Estate Tycoon running on http://localhost:${PORT}`));
}
module.exports = { server, wss, rooms };
