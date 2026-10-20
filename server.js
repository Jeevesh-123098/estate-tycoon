'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const Redis = require('ioredis');
const game = require('./game');

const PORT = process.env.PORT || 3000;
const MAX_SEATS = 8;
const IDLE_AUTOPLAY_MS = 45000;
const ROOM_TTL_SECONDS = 24 * 60 * 60;
const PRESENCE_TTL_SECONDS = 60;
const COLORS = ['#e63946', '#1d7ae0', '#2bb673', '#f4a300', '#9b59b6', '#00b8c4', '#ff6fb1', '#7a7a7a'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const INSTANCE_ID = crypto.randomUUID();
const REDIS_URL = process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL;

if (process.env.VERCEL && !REDIS_URL) {
  throw new Error('Set UPSTASH_REDIS_URL in Vercel before deploying.');
}

const redis = REDIS_URL ? new Redis(REDIS_URL, { maxRetriesPerRequest: 2 }) : null;
const subscriber = REDIS_URL ? new Redis(REDIS_URL, { maxRetriesPerRequest: 2 }) : null;
const EVENT_CHANNEL = 'estate-tycoon:events';
const subscriberReady = subscriber ? subscriber.subscribe(EVENT_CHANNEL) : Promise.resolve();
const rooms = new Map();
const sockets = new Map();
const localLocks = new Map();

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
const roomKey = (code) => `estate-tycoon:room:${code}`;
const lockKey = (code) => `estate-tycoon:lock:${code}`;
const presenceKey = (code, token) => `estate-tycoon:presence:${code}:${token}`;
const getLocalSockets = (code, token) => sockets.get(code)?.get(token) || new Set();

function addSocket(code, token, ws) {
  if (!sockets.has(code)) sockets.set(code, new Map());
  const byToken = sockets.get(code);
  if (!byToken.has(token)) byToken.set(token, new Set());
  byToken.get(token).add(ws);
}
function removeSocket(ws) {
  const ctx = ws.ctx;
  if (!ctx) return;
  const byToken = sockets.get(ctx.code);
  const tokenSockets = byToken && byToken.get(ctx.token);
  if (tokenSockets) {
    tokenSockets.delete(ws);
    if (!tokenSockets.size) byToken.delete(ctx.token);
    if (!byToken.size) sockets.delete(ctx.code);
  }
}

function makeCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return c;
}
const newToken = () => crypto.randomBytes(16).toString('hex');

function freeColor(room, want) {
  const used = new Set(room.seats.map((s) => s.color));
  if (want && COLORS.includes(want) && !used.has(want)) return want;
  return COLORS.find((c) => !used.has(c));
}

async function publish(event) {
  if (!redis) return;
  await redis.publish(EVENT_CHANNEL, JSON.stringify({ ...event, origin: INSTANCE_ID }));
}

async function withRoomLock(code, callback) {
  if (!redis) {
    const previous = localLocks.get(code) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    localLocks.set(code, queued);
    await previous;
    try { return await callback(); }
    finally {
      release();
      if (localLocks.get(code) === queued) localLocks.delete(code);
    }
  }

  const key = lockKey(code);
  const token = newToken();
  let acquired = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await redis.set(key, token, 'PX', 15000, 'NX')) { acquired = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!acquired) throw new Error(`Timed out waiting for room ${code}.`);
  try { return await callback(); }
  finally {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1, key, token,
    );
  }
}

function hydrateRoom(room) {
  room.seats.forEach((seat) => {
    const connected = Array.from(getLocalSockets(room.code, seat.token)).find((ws) => ws.readyState === 1);
    seat.ws = connected || null;
  });
  return room;
}

async function loadRoom(code) {
  if (!redis) return rooms.get(code) || null;
  const value = await redis.get(roomKey(code));
  if (!value) { rooms.delete(code); return null; }
  return hydrateRoom(JSON.parse(value));
}

async function saveRoom(room) {
  rooms.set(room.code, room);
  if (!redis) return;
  const stored = {
    ...room,
    seats: room.seats.map(({ ws, ...seat }) => ({ ...seat, ws: null })),
  };
  await redis.set(roomKey(room.code), JSON.stringify(stored), 'EX', ROOM_TTL_SECONDS);
}

async function deleteRoom(code) {
  rooms.delete(code);
  if (redis) await redis.del(roomKey(code));
}

async function isConnected(room, seat) {
  if (seat.ws && seat.ws.readyState === 1) return true;
  return redis ? !!(await redis.exists(presenceKey(room.code, seat.token))) : false;
}

async function syncConnectivity(room) {
  let changed = false;
  for (const seat of room.seats) {
    const connected = await isConnected(room, seat);
    if (connected && seat.discAt) { seat.discAt = null; changed = true; }
    else if (!connected && !seat.discAt) { seat.discAt = Date.now(); changed = true; }
  }
  return changed;
}

async function roomInfo(room) {
  const connected = await Promise.all(room.seats.map((seat) => isConnected(room, seat)));
  return {
    type: 'room',
    code: room.code,
    host: room.seats.findIndex((s) => s.token === room.hostToken),
    started: room.started,
    colors: COLORS,
    seats: room.seats.map((s, i) => ({ name: s.name, color: s.color, connected: connected[i] })),
  };
}

async function broadcast(room, obj) {
  room.seats.forEach((seat) => getLocalSockets(room.code, seat.token).forEach((ws) => send(ws, obj)));
  await publish({ code: room.code, message: obj });
}

async function sendToSeat(room, seat, message) {
  getLocalSockets(room.code, seat.token).forEach((ws) => send(ws, message));
  await publish({ code: room.code, token: seat.token, message });
}

async function pushRoom(room) { await broadcast(room, await roomInfo(room)); }

async function pushState(room) {
  if (!room.g) return;
  const connected = await Promise.all(room.seats.map((seat) => isConnected(room, seat)));
  room.g.players.forEach((player, i) => { player.connected = connected[i]; });
  await broadcast(room, { type: 'state', g: game.snapshot(room.g) });
}

function joinedMsg(room, seatIdx) {
  return { type: 'joined', code: room.code, token: room.seats[seatIdx].token, you: seatIdx, board: game.BOARD, groupMeta: game.GM };
}

async function notifyAndClose(room, seat, message) {
  const tokenSockets = getLocalSockets(room.code, seat.token);
  tokenSockets.forEach((ws) => {
    send(ws, { type: 'error', msg: message, fatal: true });
    ws.ctx = null;
    removeSocket(ws);
    ws.close();
  });
  await publish({ code: room.code, token: seat.token, message: { type: 'error', msg: message, fatal: true }, close: true });
}

async function attach(room, seatIdx, ws) {
  const seat = room.seats[seatIdx];
  if (redis) {
    const oldPresenceId = await redis.get(presenceKey(room.code, seat.token));
    if (oldPresenceId && oldPresenceId !== ws.presenceId) {
      await publish({ code: room.code, closePresenceId: oldPresenceId });
    }
    await redis.set(presenceKey(room.code, seat.token), ws.presenceId, 'EX', PRESENCE_TTL_SECONDS);
  }
  const prior = getLocalSockets(room.code, seat.token);
  prior.forEach((other) => {
    if (other !== ws) {
      other.ctx = null;
      removeSocket(other);
      other.close();
    }
  });
  addSocket(room.code, seat.token, ws);
  seat.ws = ws;
  seat.discAt = null;
  ws.ctx = { code: room.code, token: seat.token };
  await saveRoom(room);
  send(ws, joinedMsg(room, seatIdx));
  send(ws, { type: 'chatlog', msgs: room.chat });
  await pushRoom(room);
  await pushState(room);
}

const seatIndex = (room, token) => room.seats.findIndex((seat) => seat.token === token);

async function removeSeatInLobby(room, idx) {
  const [seat] = room.seats.splice(idx, 1);
  await notifyAndClose(room, seat, 'You left the room.');
  if (!room.seats.length) { await deleteRoom(room.code); return; }
  if (seat.token === room.hostToken) room.hostToken = room.seats[0].token;
  await Promise.all(room.seats.map((s, i) => sendToSeat(room, s, joinedMsg(room, i))));
  await saveRoom(room);
  await pushRoom(room);
}

async function autoplay(room) {
  const g = room.g;
  if (!g) return false;
  let changed = false;
  for (let n = 0; n < 40 && g.phase !== 'over'; n++) {
    let pi, action, idle = false;
    if (g.phase === 'auction') { pi = g.auction.current; action = { a: 'pass' }; }
    else if (g.phase === 'buy') { pi = g.turn; action = { a: 'decline' }; }
    else if (g.phase === 'debt') { pi = g.turn; action = { a: 'bankrupt' }; }
    else if (g.phase === 'roll') { pi = g.turn; action = { a: 'roll' }; idle = true; }
    else { pi = g.turn; action = { a: 'endTurn' }; idle = true; }
    const seat = room.seats[pi];
    if (!seat || await isConnected(room, seat)) break;
    if (idle && seat.discAt && Date.now() - seat.discAt < IDLE_AUTOPLAY_MS) break;
    if (game.act(g, pi, action)) break;
    changed = true;
  }
  return changed;
}

async function createRoom(ws, message) {
  for (let tries = 0; tries < 200; tries++) {
    const code = makeCode();
    const result = await withRoomLock(code, async () => {
      if (redis ? await redis.exists(roomKey(code)) : rooms.has(code)) return false;
      const token = newToken();
      const room = {
        code, hostToken: token, started: false, g: null, chat: [], seats: [],
        created: Date.now(), startCash: 1500,
      };
      room.seats.push({ token, name: clean(message.name, 16) || 'Player 1', color: COLORS[0], ws: null, discAt: null });
      await saveRoom(room);
      await attach(room, 0, ws);
      return true;
    });
    if (result) return;
  }
  throw new Error('Unable to allocate a room code.');
}

async function handle(ws, message) {
  await subscriberReady;
  if (!message || typeof message.type !== 'string') return;

  if (message.type === 'create') return createRoom(ws, message);

  if (message.type === 'join' || message.type === 'rejoin') {
    const code = clean(message.code, 4).toUpperCase();
    await withRoomLock(code, async () => {
      const room = await loadRoom(code);
      if (!room) return send(ws, { type: 'error', msg: message.type === 'join' ? 'Room not found. Check the code.' : 'Session expired.', fatal: message.type === 'rejoin' });
      if (message.type === 'join') {
        if (room.started) return send(ws, { type: 'error', msg: 'That game has already started.' });
        if (room.seats.length >= MAX_SEATS) return send(ws, { type: 'error', msg: 'Room is full (8 players max).' });
        const token = newToken();
        room.seats.push({ token, name: clean(message.name, 16) || `Player ${room.seats.length + 1}`, color: freeColor(room), ws: null, discAt: null });
        await syncConnectivity(room);
        await saveRoom(room);
        await attach(room, room.seats.length - 1, ws);
        return;
      }
      const idx = room.seats.findIndex((seat) => seat.token && seat.token === message.token);
      if (idx < 0) return send(ws, { type: 'error', msg: 'Session expired.', fatal: true });
      await attach(room, idx, ws);
      await saveRoom(room);
    });
    return;
  }

  const context = ws.ctx;
  if (!context) return;
  await withRoomLock(context.code, async () => {
    const room = await loadRoom(context.code);
    const me = room ? seatIndex(room, context.token) : -1;
    if (!room || me < 0) return;
    room.seats[me].ws = ws;
    await syncConnectivity(room);
    const isHost = room.seats[me].token === room.hostToken;
    let roomChanged = false;
    let stateChanged = false;

    switch (message.type) {
      case 'setColor':
        if (room.started) return;
        if (!COLORS.includes(message.color) || room.seats.some((seat) => seat.color === message.color)) return;
        room.seats[me].color = message.color;
        roomChanged = true;
        break;

      case 'start':
        if (!isHost || room.started) return;
        if (room.seats.length < 2) return send(ws, { type: 'error', msg: 'Need at least 2 players to start.' });
        room.started = true;
        room.g = game.createGame(room.seats, room.startCash);
        roomChanged = stateChanged = true;
        break;

      case 'action': {
        if (!room.started || !room.g) return;
        const error = game.act(room.g, me, message);
        if (error) return send(ws, { type: 'error', msg: error });
        if (await autoplay(room)) stateChanged = true;
        stateChanged = true;
        break;
      }

      case 'chat': {
        const text = clean(message.text, 200);
        if (!text) return;
        const chatMessage = { type: 'chat', name: room.seats[me].name, color: room.seats[me].color, text };
        room.chat.push(chatMessage);
        if (room.chat.length > 60) room.chat.shift();
        await saveRoom(room);
        await broadcast(room, chatMessage);
        return;
      }

      case 'kick': {
        if (!isHost || !Number.isInteger(message.seat) || message.seat === me || !room.seats[message.seat]) return;
        const target = room.seats[message.seat];
        if (!room.started) {
          await removeSeatInLobby(room, message.seat);
          return;
        }
        const error = game.forfeit(room.g, message.seat);
        if (error) return send(ws, { type: 'error', msg: error });
        await notifyAndClose(room, target, 'You were removed by the host.');
        target.token = null;
        target.ws = null;
        await autoplay(room);
        roomChanged = stateChanged = true;
        break;
      }

      case 'leave': {
        if (!room.started) {
          await removeSeatInLobby(room, me);
          ws.ctx = null;
          removeSocket(ws);
          if (redis) await redis.del(presenceKey(room.code, context.token));
          return;
        }
        game.forfeit(room.g, me);
        const seat = room.seats[me];
        seat.token = null;
        seat.ws = null;
        ws.ctx = null;
        removeSocket(ws);
        if (redis) await redis.del(presenceKey(room.code, context.token));
        send(ws, { type: 'error', msg: 'You left the game.', fatal: true });
        await autoplay(room);
        roomChanged = stateChanged = true;
        break;
      }

      default: return;
    }

    if (roomChanged || stateChanged) await saveRoom(room);
    if (roomChanged) await pushRoom(room);
    if (stateChanged && room.g) await pushState(room);
  });
}

function removePresenceSocket(presenceId) {
  for (const byToken of sockets.values()) {
    for (const tokenSockets of byToken.values()) {
      for (const ws of tokenSockets) {
        if (ws.presenceId === presenceId) {
          ws.ctx = null;
          removeSocket(ws);
          ws.close();
        }
      }
    }
  }
}

if (subscriber) {
  subscriberReady.catch((error) => console.error('Redis subscription failed', error));
  subscriber.on('message', (channel, raw) => {
    if (channel !== EVENT_CHANNEL) return;
    try {
      const event = JSON.parse(raw);
      if (event.origin === INSTANCE_ID) return;
      if (event.closePresenceId) removePresenceSocket(event.closePresenceId);
      const recipients = event.token
        ? getLocalSockets(event.code, event.token)
        : Array.from(sockets.get(event.code)?.values() || []).flatMap((set) => Array.from(set));
      recipients.forEach((ws) => {
        if (event.message) send(ws, event.message);
        if (event.close) { ws.ctx = null; removeSocket(ws); ws.close(); }
      });
    } catch (error) {
      console.error('Invalid Redis event', error);
    }
  });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.presenceId = `${INSTANCE_ID}:${crypto.randomUUID()}`;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch (error) { return; }
    handle(ws, message).catch((error) => {
      console.error('handler error', error);
      send(ws, { type: 'error', msg: 'Server unavailable. Please try again.' });
    });
  });
  ws.on('close', () => {
    const context = ws.ctx;
    removeSocket(ws);
    if (!context) return;
    const disconnect = async () => {
      if (redis) {
        const current = await redis.get(presenceKey(context.code, context.token));
        if (current === ws.presenceId) await redis.del(presenceKey(context.code, context.token));
      }
      await withRoomLock(context.code, async () => {
        const room = await loadRoom(context.code);
        if (!room) return;
        const idx = seatIndex(room, context.token);
        if (idx < 0) return;
        room.seats[idx].ws = null;
        room.seats[idx].discAt = Date.now();
        await autoplay(room);
        await saveRoom(room);
        await pushRoom(room);
        if (room.g) await pushState(room);
      });
    };
    disconnect().catch((error) => console.error('disconnect handler error', error));
  });
});

setInterval(() => {
  const activeRooms = Array.from(sockets.keys());
  activeRooms.forEach((code) => {
    withRoomLock(code, async () => {
      const room = await loadRoom(code);
      if (!room) return;
      let changed = await syncConnectivity(room);
      if (!room.started) {
        for (let i = room.seats.length - 1; i >= 0; i--) {
          const seat = room.seats[i];
          if (!await isConnected(room, seat) && seat.discAt && Date.now() - seat.discAt > 30000) {
            await removeSeatInLobby(room, i);
            changed = true;
          }
        }
        if (!room.seats.length) return;
      } else if (await autoplay(room)) {
        changed = true;
      }
      if (changed) {
        await saveRoom(room);
        await pushRoom(room);
        if (room.g) await pushState(room);
      } else if (redis) {
        await redis.expire(roomKey(code), ROOM_TTL_SECONDS);
      }
    }).catch((error) => console.error('room maintenance error', error));
  });
  for (const byToken of sockets.values()) {
    for (const token of byToken.keys()) {
      const socket = Array.from(byToken.get(token)).find((ws) => ws.ctx);
      if (socket) {
        if (!socket.isAlive) {
          socket.terminate();
          continue;
        }
        socket.isAlive = false;
        try { socket.ping(); } catch (error) { console.error('WebSocket ping failed', error); }
        if (redis) {
          redis.expire(presenceKey(socket.ctx.code, token), PRESENCE_TTL_SECONDS)
            .catch((error) => console.error('Presence refresh failed', error));
        }
      }
    }
  }
}, 20000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`Estate Tycoon running on http://localhost:${PORT}`));
}
module.exports = { server, wss, rooms };
