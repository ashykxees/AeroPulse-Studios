require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, 'data.json');
const WHITELIST_FILE = path.join(__dirname, 'whitelist.json');
const discordUserCache = new Map();

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

function loadWhitelist() {
  return loadJSON(WHITELIST_FILE);
}

function loadData() {
  const data = loadJSON(DATA_FILE);
  if (!data.djEmpire) {
    data.djEmpire = { totalEarnings: 0, equity: {}, paidOutEarnings: {}, payoutRequests: [] };
  }
  if (!data.djEmpire.paidOutEarnings) data.djEmpire.paidOutEarnings = {};
  if (!data.djEmpire.payoutRequests) data.djEmpire.payoutRequests = [];
  return data;
}

function saveData(data) {
  saveJSON(DATA_FILE, data);
}

async function sendDiscordDM(userId, message) {
  const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_CLIENT_SECRET;
  if (!token) return;
  try {
    const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: userId })
    });
    if (!dmRes.ok) return;
    const channel = await dmRes.json();
    await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message })
    });
  } catch {
    // ignore DM failures
  }
}

async function fetchDiscordUser(userId) {
  if (discordUserCache.has(userId)) return discordUserCache.get(userId);
  const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_CLIENT_SECRET;
  if (!token) return null;
  try {
    const res = await fetch(`https://discord.com/api/v10/users/${userId}`, {
      headers: { Authorization: `Bot ${token}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const avatar = data.avatar
      ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${(BigInt(data.id) >> 22n) % 6n}.png`;
    const user = { id: data.id, username: data.username, avatar };
    discordUserCache.set(userId, user);
    return user;
  } catch {
    return null;
  }
}

function saveWhitelist(list) {
  saveJSON(WHITELIST_FILE, list);
}

function isWhitelisted(id) {
  const list = loadWhitelist();
  return list.find(u => u.id === id);
}

function isAdmin(id) {
  const user = isWhitelisted(id);
  return user && user.role === 'admin';
}

function ensureAuth(req, res, next) {
  if (req.isAuthenticated() && isWhitelisted(req.user.id)) return next();
  res.redirect('/login');
}

function ensureAdmin(req, res, next) {
  if (req.isAuthenticated() && isAdmin(req.user.id)) return next();
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
  res.json({ user: req.user, isAdmin: isAdmin(req.user.id) });
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

app.post('/api/admin/owners', ensureAdmin, (req, res) => {
  const { userId, percent = 0 } = req.body;
  const value = Number(percent);
  if (!userId || Number.isNaN(value) || value < 0 || value > 100) {
    return res.status(400).json({ error: 'Invalid user or percent' });
  }

  const whitelist = loadWhitelist();
  if (!whitelist.find(u => u.id === userId)) {
    whitelist.push({ id: userId });
    saveWhitelist(whitelist);
  }

  const data = loadData();
  if (!data.djEmpire.equity) data.djEmpire.equity = {};
  data.djEmpire.equity[userId] = value;
  saveData(data);

  res.json({ success: true, equity: data.djEmpire.equity });
});

app.delete('/api/admin/owners/:userId', ensureAdmin, (req, res) => {
  const userId = req.params.userId;
  const data = loadData();
  if (data.djEmpire?.equity) {
    delete data.djEmpire.equity[userId];
    saveData(data);
  }
  res.json({ success: true, equity: data.djEmpire?.equity || {} });
});

app.post('/api/admin/earnings', ensureAdmin, (req, res) => {
  const { amount } = req.body;
  const value = Number(amount);
  if (Number.isNaN(value) || value < 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  const data = loadData();
  data.djEmpire.totalEarnings = value;
  saveData(data);
  res.json({ success: true, totalEarnings: value });
});

app.post('/api/admin/equity', ensureAdmin, (req, res) => {
  const { userId, percent } = req.body;
  const value = Number(percent);
  if (!userId || Number.isNaN(value) || value < 0 || value > 100) {
    return res.status(400).json({ error: 'Invalid user or percent' });
  }
  const data = loadData();
  if (!data.djEmpire.equity) data.djEmpire.equity = {};
  data.djEmpire.equity[userId] = value;
  saveData(data);
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
  saveData(data);

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

app.post('/api/admin/payouts/:userId/pay', ensureAdmin, (req, res) => {
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
  saveData(data);

  res.json({ success: true, paidOut: data.djEmpire.paidOutEarnings[userId] });
});

app.get('/landing', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/games', (req, res) => res.sendFile(path.join(__dirname, 'games.html')));
app.get('/team', (req, res) => res.sendFile(path.join(__dirname, 'team.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(__dirname, 'contact.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));

app.get('/', (req, res) => res.redirect('/landing'));

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

app.listen(PORT, () => {
  console.log(`AeroPulse server running on http://localhost:${PORT}`);
});
