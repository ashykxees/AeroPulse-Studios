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
  return loadJSON(DATA_FILE);
}

function saveData(data) {
  saveJSON(DATA_FILE, data);
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
  res.redirect('/login.html');
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

app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/login.html' }),
  (req, res) => {
    if (!isWhitelisted(req.user.id)) {
      req.logout(() => {});
      return res.redirect('/login.html?error=not-authorized');
    }
    res.redirect('/dashboard');
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

app.get('/api/equity', ensureAuth, (req, res) => {
  const data = loadData();
  const equity = data.djEmpire?.equity?.[req.user.id] || 0;
  const total = data.djEmpire?.totalEarnings || 0;
  const share = Math.floor((total * equity) / 100);

  res.json({
    game: 'DJ Empire',
    equity,
    totalEarnings: total,
    yourEarnings: share
  });
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

app.use(express.static(path.join(__dirname)));

app.get('/dashboard', ensureAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.listen(PORT, () => {
  console.log(`AeroPulse server running on http://localhost:${PORT}`);
});
