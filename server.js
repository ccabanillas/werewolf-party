const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory game store
const games = {};

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const AVAILABLE_ROLES = {
  Werewolf:  { team: 'evil',    desc: 'Kills a villager each night' },
  Villager:  { team: 'good',    desc: 'Find and eliminate the werewolves' },
  Seer:      { team: 'good',    desc: 'Inspects one player per night' },
  Doctor:    { team: 'good',    desc: 'Protects one player per night' }
};

function buildRoles(roleCounts, playerCount) {
  const roles = [];
  for (const [role, count] of Object.entries(roleCounts)) {
    if (!AVAILABLE_ROLES[role]) continue;
    for (let i = 0; i < count; i++) roles.push(role);
  }
  // Fill remaining with Villager
  while (roles.length < playerCount) roles.push('Villager');
  // Shuffle
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  return roles;
}

function defaultRoles(playerCount) {
  const counts = { Werewolf: 1, Seer: 1, Doctor: 1, Villager: 0 };
  if (playerCount >= 7) counts.Werewolf = 2;
  if (playerCount >= 10) counts.Werewolf = 3;
  return counts;
}

// Create game
app.post('/api/games', (req, res) => {
  let code;
  do { code = generateCode(); } while (games[code]);
  games[code] = {
    code,
    players: [],
    started: false,
    createdAt: Date.now()
  };
  res.json({ code });
});

// Join game
app.post('/api/games/:code/join', (req, res) => {
  const game = games[req.params.code.toUpperCase()];
  if (!game) return res.status(404).json({ error: 'Game not found' });
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });

  const trimmed = name.trim();
  const existing = game.players.find(p => p.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    // Allow rejoin — return their existing player ID
    return res.json({ playerId: existing.id, gameCode: game.code, rejoined: true });
  }

  if (game.started) return res.status(400).json({ error: 'Game already started — ask moderator to add you' });

  const id = Math.random().toString(36).substring(2, 10);
  const player = { id, name: trimmed, role: null, alive: true };
  game.players.push(player);
  res.json({ playerId: id, gameCode: game.code });
});

// Get available roles
app.get('/api/roles', (req, res) => {
  res.json(AVAILABLE_ROLES);
});

// Start game (assign roles)
app.post('/api/games/:code/start', (req, res) => {
  const game = games[req.params.code.toUpperCase()];
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (game.started) return res.status(400).json({ error: 'Game already started' });
  if (game.players.length < 4) return res.status(400).json({ error: 'Need at least 4 players' });

  const roleCounts = req.body.roles || defaultRoles(game.players.length);
  const totalAssigned = Object.values(roleCounts).reduce((s, n) => s + n, 0);
  if (totalAssigned > game.players.length) {
    return res.status(400).json({ error: `Too many roles (${totalAssigned}) for ${game.players.length} players` });
  }

  // Must have at least 1 werewolf
  const wwCount = (roleCounts.Werewolf || 0) + (roleCounts.Drunk || 0);
  if (wwCount < 1) {
    return res.status(400).json({ error: 'Need at least 1 Werewolf' });
  }

  const roles = buildRoles(roleCounts, game.players.length);
  game.players.forEach((p, i) => { p.role = roles[i]; });
  game.started = true;
  res.json({ ok: true });
});

// Get player's own role
app.get('/api/games/:code/role/:playerId', (req, res) => {
  const game = games[req.params.code.toUpperCase()];
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const player = game.players.find(p => p.id === req.params.playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  res.json({ name: player.name, role: player.role, alive: player.alive });
});

// Get game state (moderator view - shows all roles; player view - hides roles)
app.get('/api/games/:code', (req, res) => {
  const game = games[req.params.code.toUpperCase()];
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const isMod = req.query.mod === 'true';
  const players = game.players.map(p => ({
    id: p.id,
    name: p.name,
    alive: p.alive,
    role: isMod ? p.role : undefined
  }));
  res.json({ code: game.code, started: game.started, players });
});

// Eliminate player
app.post('/api/games/:code/eliminate/:playerId', (req, res) => {
  const game = games[req.params.code.toUpperCase()];
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const player = game.players.find(p => p.id === req.params.playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  player.alive = !player.alive; // Toggle so moderator can undo mistakes
  res.json({ name: player.name, alive: player.alive });
});

// Remove player
app.delete('/api/games/:code/players/:playerId', (req, res) => {
  const game = games[req.params.code.toUpperCase()];
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const idx = game.players.findIndex(p => p.id === req.params.playerId);
  if (idx === -1) return res.status(404).json({ error: 'Player not found' });

  const removed = game.players.splice(idx, 1)[0];
  res.json({ removed: removed.name });
});

// Reset game (keep players, reassign roles)
app.post('/api/games/:code/reset', (req, res) => {
  const game = games[req.params.code.toUpperCase()];
  if (!game) return res.status(404).json({ error: 'Game not found' });

  game.started = false;
  game.players.forEach(p => { p.role = null; p.alive = true; });
  res.json({ ok: true });
});

// Cleanup old games every 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 4 * 60 * 60 * 1000; // 4 hours
  for (const code in games) {
    if (games[code].createdAt < cutoff) delete games[code];
  }
}, 30 * 60 * 1000);

app.listen(PORT, () => console.log(`Werewolf running on port ${PORT}`));
