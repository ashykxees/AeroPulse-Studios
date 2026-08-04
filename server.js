require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DATA_FILE = path.join(DATA_DIR, 'data.json');
const WHITELIST_FILE = path.join(DATA_DIR, 'whitelist.json');
const WHITELIST_TEMPLATE = path.join(__dirname, 'whitelist.json');

const discordUserCache = new Map();
let state = null;
let pool = null;

function loadJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function ensureDataShape(data) {
  if (!data.djEmpire) data.djEmpire = { totalEarnings: 0, equity: {}, paidOutEarnings: {}, payoutRequests: [] };
  if (!data.djEmpire.paidOutEarnings) data.djEmpire.paidOutEarnings = {};
  if (!data.djEmpire.payoutRequests) data.djEmpire.payoutRequests = [];
  if (!data.tasks) data.tasks = [];
}

function readWhitelist(file) {
  const val = loadJSON(file);
  return Array.isArray(val) ? val : [];
}

async function persistDB() {
  if (!pool) return;
  await Promise.all([
    pool.query("INSERT INTO app_state (key, value) VALUES ('data', $1) ON CONFLICT (key) DO UPDATE SET value=$1", [JSON.stringify(state.data)]),
    pool.query("INSERT INTO app_state (key, value) VALUES ('whitelist', $1) ON CONFLICT (key) DO UPDATE SET value=$1", [JSON.stringify(state.whitelist)])
  ]);
}

async function persistJSON() {
  saveJSON(DATA_FILE, state.data);
  saveJSON(WHITELIST_FILE, state.whitelist);
}

async function initStorage() {
  if (process.env.DATABASE_URL) {
    try {
      const { Pool } = require('pg');
      pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
      await pool.query(`CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value JSONB NOT NULL)`);
      const [dataRow, whitelistRow] = await Promise.all([
        pool.query("SELECT value FROM app_state WHERE key='data'"),
        pool.query("SELECT value FROM app_state WHERE key='whitelist'")
      ]);
      const data = dataRow.rows[0]?.value || {};
      ensureDataShape(data);
      const templateWhitelist = readWhitelist(WHITELIST_TEMPLATE);
      const whitelist = whitelistRow.rows[0]?.value || templateWhitelist;
      // Merge role updates from the repo template without overwriting other changes
      for (const templateUser of templateWhitelist) {
        const existing = whitelist.find(u => u.id === templateUser.id);
        if (existing && templateUser.role && !existing.role) {
          existing.role = templateUser.role;
        }
      }
      state = { data, whitelist, persist: persistDB };
      await state.persist();
      console.log('Postgres storage initialized');
      return;
    } catch (err) {
      console.error('Postgres init failed, falling back to JSON files:', err.message);
      pool = null;
    }
  }

  const data = loadJSON(DATA_FILE);
  ensureDataShape(data);
  const existingWhitelist = readWhitelist(WHITELIST_FILE);
  const templateWhitelist = readWhitelist(WHITELIST_TEMPLATE);
  const whitelist = existingWhitelist.length ? existingWhitelist : templateWhitelist;
  // Merge role updates from the repo template without overwriting other changes
  for (const templateUser of templateWhitelist) {
    const existing = whitelist.find(u => u.id === templateUser.id);
    if (existing && templateUser.role && !existing.role) {
      existing.role = templateUser.role;
    }
  }
  state = { data, whitelist, persist: persistJSON };
  await state.persist();
  if (!existingWhitelist.length && fs.existsSync(WHITELIST_TEMPLATE)) {
    fs.copyFileSync(WHITELIST_TEMPLATE, WHITELIST_FILE);
  }
  console.log('JSON file storage initialized');
}

function loadWhitelist() {
  return state.whitelist;
}

function loadData() {
  return state.data;
}

async function saveData(data) {
  state.data = data;
  await state.persist();
}

async function saveWhitelist(list) {
  state.whitelist = list;
  await state.persist();
}

function getBotToken() {
  if (process.env.DISCORD_BOT_TOKEN) return process.env.DISCORD_BOT_TOKEN;
  const secret = process.env.DISCORD_CLIENT_SECRET;
  // Bot tokens have 3 dot-separated parts; OAuth client secrets do not.
  if (secret && secret.split('.').length === 3) return secret;
  return null;
}

async function sendDiscordDM(userId, payload) {
  const token = getBotToken();
  if (!token) {
    console.log('Discord DM skipped: no bot token');
    return;
  }
  const body = typeof payload === 'string' ? { content: payload } : payload;
  try {
    const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: userId })
    });
    if (!dmRes.ok) {
      const err = await dmRes.text();
      console.error('Discord DM channel create failed:', dmRes.status, err);
      return;
    }
    const channel = await dmRes.json();
    const msgRes = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!msgRes.ok) {
      console.error('Discord DM send failed:', msgRes.status, await msgRes.text());
    } else {
      console.log('Discord DM sent to', userId);
    }
  } catch (err) {
    console.error('Discord DM exception:', err.message);
  }
}

function parseDiscordDogMeta(html) {
  const titleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (!titleMatch) return null;
  const title = titleMatch[1].replace(' | Discord', '').trim();
  if (/private|unknown|not found|hidden/i.test(title)) return null;
  return { username: title };
}

async function fetchDiscordDogUser(userId) {
  try {
    const res = await fetch(`https://discord.dog/${userId}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    const html = await res.text();
    const meta = parseDiscordDogMeta(html);
    if (!meta) return null;
    return {
      id: userId,
      username: meta.username,
      avatar: `https://cdn.discordapp.com/embed/avatars/${(BigInt(userId) >> 22n) % 6n}.png`
    };
  } catch {
    return null;
  }
}

async function fetchDiscordUser(userId) {
  if (discordUserCache.has(userId)) return discordUserCache.get(userId);

  const token = getBotToken();
  if (token) {
    try {
      const res = await fetch(`https://discord.com/api/v10/users/${userId}`, {
        headers: { Authorization: `Bot ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const avatar = data.avatar
          ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png?size=128`
          : `https://cdn.discordapp.com/embed/avatars/${(BigInt(data.id) >> 22n) % 6n}.png`;
        const user = { id: data.id, username: data.username, avatar };
        discordUserCache.set(userId, user);
        return user;
      }
    } catch {
      // fall through
    }
  }

  const fallback = await fetchDiscordDogUser(userId);
  if (fallback) discordUserCache.set(userId, fallback);
  return fallback;
}

function saveWhitelist(list) {
  saveJSON(WHITELIST_FILE, list);
}

function isWhitelisted(id) {
  const list = loadWhitelist();
  return list.find(u => u.id === id);
}

function getRole(id) {
  const user = isWhitelisted(id);
  return user?.role || null;
}

function isAdmin(id) {
  return getRole(id) === 'admin';
}

function isManager(id) {
  const role = getRole(id);
  return role === 'admin' || role === 'manager';
}

function isDeveloper(id) {
  const role = getRole(id);
  return role === 'admin' || role === 'manager' || role === 'developer';
}

function ensureAuth(req, res, next) {
  if (req.isAuthenticated() && isWhitelisted(req.user.id)) return next();
  res.redirect('/login');
}

function ensureAdmin(req, res, next) {
  if (req.isAuthenticated() && isAdmin(req.user.id)) return next();
  res.status(403).json({ error: 'Forbidden' });
}

function ensureManager(req, res, next) {
  if (req.isAuthenticated() && isManager(req.user.id)) return next();
  res.status(403).json({ error: 'Forbidden' });
}

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

app.use(passport.initialize());
app.use(passport.session());

if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
  passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL || 'http://localhost:3000/auth/discord/callback',
    scope: ['identify']
  }, (accessToken, refreshToken, profile, done) => {
    const user = {
      id: profile.id,
      username: profile.username,
      avatar: profile.avatar
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${(BigInt(profile.id) >> 22n) % 6n}.png`
    };
    return done(null, user);
  }));
} else {
  console.warn('Discord OAuth credentials not set. Login with Discord will not work.');
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

app.get('/auth/discord',
  passport.authenticate('discord', { scope: ['identify'] }),
  (req, res) => { res.send('Redirecting to Discord...'); });

app.get('/auth/discord/callback', (req, res, next) => {
  passport.authenticate('discord', (err, user, info) => {
    if (err) {
      console.error('Discord OAuth error:', err.code, err.message, err.oauthError);
      const details = `Error code: ${err.code || 'unknown'} | Message: ${err.message || 'none'} | OAuth error: ${err.oauthError || 'none'}`;
      return res.status(400).send(`<h1>Discord login failed</h1><p>${details}</p><p>Make sure the Discord redirect URI in https://discord.com/developers/applications exactly matches DISCORD_CALLBACK_URL: <code>${process.env.DISCORD_CALLBACK_URL || 'not set'}</code></p><a href='/login'>Back to login</a>`);
    }
    if (!user) {
      return res.redirect('/login');
    }
    req.login(user, loginErr => {
      if (loginErr) return next(loginErr);
      if (!isWhitelisted(user.id)) {
        req.logout(() => {});
        return res.redirect('/landing?error=not-whitelisted');
      }
      res.redirect('/dashboard');
    });
  })(req, res, next);
});

app.get('/auth/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    res.redirect('/');
  });
});

if (process.env.DEV_LOGIN === 'true') {
  app.get('/auth/dev', (req, res) => {
    const testUser = { id: '1440014645783035934', username: 'yJ_ake (dev)', avatar: '' };
    req.login(testUser, err => {
      if (err) return res.status(500).send('Dev login failed');
      res.redirect('/dashboard');
    });
  });
}

app.get('/api/me', ensureAuth, (req, res) => {
  const role = getRole(req.user.id);
  res.json({ user: { ...req.user, role }, isAdmin: isAdmin(req.user.id), isManager: isManager(req.user.id), isDeveloper: isDeveloper(req.user.id) });
});

function userEarnings(data, userId) {
  const equity = data.djEmpire?.equity?.[userId] || 0;
  const total = data.djEmpire?.totalEarnings || 0;
  const paidOut = data.djEmpire?.paidOutEarnings?.[userId] || 0;
  const share = Math.floor((total * equity) / 100) - paidOut;
  return Math.max(0, share);
}

app.get('/api/equity', ensureAuth, (req, res) => {
  const data = loadData();
  res.json({
    game: 'DJ Empire',
    equity: data.djEmpire?.equity?.[req.user.id] || 0,
    totalEarnings: data.djEmpire?.totalEarnings || 0,
    yourEarnings: userEarnings(data, req.user.id)
  });
});

app.get('/api/admin/equity/list', ensureAdmin, async (req, res) => {
  const data = loadData();
  const list = Object.entries(data.djEmpire?.equity || {}).map(([userId, percent]) => ({ userId, percent }));
  const enriched = await Promise.all(list.map(async (entry) => {
    entry.paidOut = data.djEmpire?.paidOutEarnings?.[entry.userId] || 0;
    entry.earnings = userEarnings(data, entry.userId);
    entry.user = await fetchDiscordUser(entry.userId);
    return entry;
  }));
  res.json(enriched);
});

app.post('/api/admin/owners', ensureAdmin, async (req, res) => {
  const { userId, percent = 0 } = req.body;
  const value = Number(percent);
  if (!userId || Number.isNaN(value) || value < 0 || value > 100) {
    return res.status(400).json({ error: 'Invalid user or percent' });
  }

  const whitelist = loadWhitelist();
  if (!whitelist.find(u => u.id === userId)) {
    whitelist.push({ id: userId });
    await saveWhitelist(whitelist);
  }

  const data = loadData();
  if (!data.djEmpire.equity) data.djEmpire.equity = {};
  data.djEmpire.equity[userId] = value;
  await saveData(data);

  res.json({ success: true, equity: data.djEmpire.equity });
});

app.delete('/api/admin/owners/:userId', ensureAdmin, async (req, res) => {
  const userId = req.params.userId;
  const data = loadData();
  if (data.djEmpire?.equity) {
    delete data.djEmpire.equity[userId];
    await saveData(data);
  }
  res.json({ success: true, equity: data.djEmpire?.equity || {} });
});

app.post('/api/admin/earnings', ensureAdmin, async (req, res) => {
  const { amount } = req.body;
  const value = Number(amount);
  if (Number.isNaN(value) || value < 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  const data = loadData();
  data.djEmpire.totalEarnings = (data.djEmpire.totalEarnings || 0) + value;
  await saveData(data);
  res.json({ success: true, totalEarnings: data.djEmpire.totalEarnings });
});

app.post('/api/admin/earnings/set', ensureAdmin, async (req, res) => {
  const { amount } = req.body;
  const value = Number(amount);
  if (Number.isNaN(value) || value < 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  const data = loadData();
  data.djEmpire.totalEarnings = value;
  await saveData(data);
  res.json({ success: true, totalEarnings: data.djEmpire.totalEarnings });
});

app.post('/api/admin/equity', ensureAdmin, async (req, res) => {
  const { userId, percent } = req.body;
  const value = Number(percent);
  if (!userId || Number.isNaN(value) || value < 0 || value > 100) {
    return res.status(400).json({ error: 'Invalid user or percent' });
  }
  const data = loadData();
  if (!data.djEmpire.equity) data.djEmpire.equity = {};
  data.djEmpire.equity[userId] = value;
  await saveData(data);
  res.json({ success: true, equity: data.djEmpire.equity });
});

app.get('/api/payout/request', ensureAuth, async (req, res) => {
  const data = loadData();
  const amount = userEarnings(data, req.user.id);
  if (amount <= 0) {
    return res.status(400).json({ error: 'No earnings to request' });
  }

  const existing = data.djEmpire.payoutRequests.find(r => r.userId === req.user.id && r.status === 'pending');
  if (existing) {
    existing.amount = amount;
    existing.requestedAt = Date.now();
  } else {
    data.djEmpire.payoutRequests.push({ userId: req.user.id, amount, status: 'pending', requestedAt: Date.now() });
  }
  await saveData(data);

  const admin = loadWhitelist().find(u => u.role === 'admin');
  if (admin) {
    const requester = req.user.username || req.user.id;
    sendDiscordDM(admin.id, `Payout request from ${requester} for ${amount.toLocaleString()} R$`);
  }

  res.json({ success: true, amount });
});

app.get('/api/admin/payouts', ensureAdmin, async (req, res) => {
  const data = loadData();
  const pending = data.djEmpire.payoutRequests.filter(r => r.status === 'pending');
  const enriched = await Promise.all(pending.map(async (r) => {
    r.user = await fetchDiscordUser(r.userId);
    return r;
  }));
  res.json(enriched);
});

app.post('/api/admin/payouts/:userId/pay', ensureAdmin, async (req, res) => {
  const userId = req.params.userId;
  const data = loadData();
  const request = data.djEmpire.payoutRequests.find(r => r.userId === userId && r.status === 'pending');
  if (!request) {
    return res.status(404).json({ error: 'No pending payout request' });
  }

  const paidOut = data.djEmpire.paidOutEarnings[userId] || 0;
  data.djEmpire.paidOutEarnings[userId] = paidOut + request.amount;
  request.status = 'paid';
  request.paidAt = Date.now();
  await saveData(data);

  res.json({ success: true, paidOut: data.djEmpire.paidOutEarnings[userId] });
});

// Tasks
app.get('/api/admin/tasks/users', ensureManager, async (req, res) => {
  const list = loadWhitelist();
  const enriched = await Promise.all(list.map(async (u) => {
    const user = await fetchDiscordUser(u.id);
    return { id: u.id, username: user?.username || u.id, role: u.role || 'user', avatar: user?.avatar };
  }));
  res.json(enriched);
});

app.post('/api/admin/tasks', ensureManager, async (req, res) => {
  const { title, description, assignee } = req.body;
  if (!title || !assignee) {
    return res.status(400).json({ error: 'Title and assignee required' });
  }
  if (!isWhitelisted(assignee)) {
    return res.status(400).json({ error: 'Assignee is not whitelisted' });
  }
  const data = loadData();
  const task = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    title,
    description: description || '',
    assignee,
    assignedBy: req.user.id,
    status: 'open',
    createdAt: Date.now(),
    completedAt: null
  };
  data.tasks.push(task);
  await saveData(data);

  const baseUrl = `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;
  const boardUrl = `${baseUrl}/dashboard`;
  const assigner = await fetchDiscordUser(req.user.id);
  const assignerName = assigner?.username || 'A manager';
  const safeTitle = title.replace(/\*/g, '').slice(0, 256);
  const safeDescription = description ? description.replace(/\*/g, '').slice(0, 1000) : 'No description provided.';
  const payload = {
    embeds: [{
      title: safeTitle,
      description: safeDescription,
      url: boardUrl,
      color: 0x0ea5e9,
      author: { name: 'AeroPulse Studios' },
      fields: [
        { name: 'Assigned by', value: assignerName, inline: true },
        { name: 'Task board', value: `[Open dashboard](${boardUrl})`, inline: true }
      ],
      footer: { text: 'Click the title to view your task board.' }
    }]
  };
  sendDiscordDM(assignee, payload).catch(() => {});

  res.json({ success: true, task });
});

app.get('/api/tasks', ensureAuth, async (req, res) => {
  const data = loadData();
  const tasks = data.tasks.filter(t => t.assignee === req.user.id && t.status === 'open');
  const enriched = await Promise.all(tasks.map(async (t) => {
    const assignerUser = await fetchDiscordUser(t.assignedBy);
    return { ...t, assigner: assignerUser || { username: t.assignedBy } };
  }));
  res.json(enriched);
});

app.post('/api/tasks/:id/complete', ensureAuth, async (req, res) => {
  const data = loadData();
  const task = data.tasks.find(t => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  if (task.assignee !== req.user.id && !isManager(req.user.id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (task.status === 'completed') {
    return res.status(400).json({ error: 'Task already completed' });
  }
  task.status = 'completed';
  task.completedAt = Date.now();
  await saveData(data);
  res.json({ success: true, task });
});

app.get('/api/admin/tasks', ensureManager, async (req, res) => {
  const data = loadData();
  const tasks = data.tasks.filter(t => t.status !== 'completed');
  const enriched = await Promise.all(tasks.map(async (t) => {
    const assigneeUser = await fetchDiscordUser(t.assignee);
    const assignerUser = await fetchDiscordUser(t.assignedBy);
    return { ...t, assignee: assigneeUser || { username: t.assignee }, assigner: assignerUser || { username: t.assignedBy } };
  }));
  res.json(enriched);
});

app.get('/api/admin/tasks/completed', ensureManager, async (req, res) => {
  const data = loadData();
  const tasks = data.tasks.filter(t => t.status === 'completed');
  const enriched = await Promise.all(tasks.map(async (t) => {
    const assigneeUser = await fetchDiscordUser(t.assignee);
    const assignerUser = await fetchDiscordUser(t.assignedBy);
    return { ...t, assignee: assigneeUser || { username: t.assignee }, assigner: assignerUser || { username: t.assignedBy } };
  }));
  res.json(enriched);
});

app.delete('/api/admin/tasks/:id', ensureManager, async (req, res) => {
  const data = loadData();
  const index = data.tasks.findIndex(t => t.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Task not found' });
  }
  data.tasks.splice(index, 1);
  await saveData(data);
  res.json({ success: true });
});

app.get('/landing', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/games', (req, res) => res.sendFile(path.join(__dirname, 'games.html')));
app.get('/team', (req, res) => res.sendFile(path.join(__dirname, 'team.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(__dirname, 'contact.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));

app.get('/', (req, res) => res.redirect(301, '/landing'));

app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    const clean = req.path.replace(/\.html$/, '');
    const map = {
      '/index': '/landing',
      '/login': '/login',
      '/games': '/games',
      '/team': '/team',
      '/contact': '/contact',
      '/dashboard': '/dashboard'
    };
    return res.redirect(301, map[clean] || clean);
  }
  next();
});

app.use(express.static(path.join(__dirname)));

app.get('/dashboard', ensureAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

async function start() {
  await initStorage();
  app.listen(PORT, () => {
    console.log(`AeroPulse server running on http://localhost:${PORT}`);
    console.log(`Data directory: ${DATA_DIR}`);
  });
}

start();
