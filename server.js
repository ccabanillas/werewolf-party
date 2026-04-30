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

function assignRoles(playerCount) {
  const roles = [];
  if (playerCount <= 6) {
    roles.push('Werewolf', 'Seer', 'Doctor');
    while (roles.length < playerCount) roles.push('Villager');
  } else if (playerCount <= 9) {
    roles.push('Werewolf', 'Werewolf', 'Seer', 'Doctor');
    while (roles.length < playerCount) roles.push('Villager');
  } else {
    roles.push('Werewolf', 'Werewolf', 'Werewolf', 'Seer', 'Doctor');
    while (roles.length < playerCount) roles.push('Villager');
  }
  // Shuffle
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  return roles;
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
  if (game.started) return res.status(400).json({ error: 'Game already started' });

  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });

  const trimmed = name.trim();
  if (game.players.find(p => p.name.toLowerCase() === trimmed.toLowerCase())) {
    return res.status(400).json({ error: 'Name already taken' });
  }

  const id = Math.random().toString(36).substring(2, 10);
  const player = { id, name: trimmed, role: null, alive: true };
  game.players.push(player);
  res.json({ playerId: id, gameCode: game.code });
});

// Start game (assign roles)
app.post('/api/games/:code/start', (req, res) => {
  const game = games[req.params.code.toUpperCase()];
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (game.started) return res.status(400).json({ error: 'Game already started' });
  if (game.players.length < 4) return res.status(400).json({ error: 'Need at least 4 players' });

  const roles = assignRoles(game.players.length);
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
