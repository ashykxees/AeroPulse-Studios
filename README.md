# AeroPulse Studios

A website for AeroPulse Studios, an independent game studio, with a Discord-OAuth equity dashboard.

> **Note:** GitHub Pages only serves static files, so `/dashboard` and Discord login will not work there. The Node.js backend must be deployed on a platform that runs a server (Render, Fly.io, Railway, etc.).

## Pages

- **Home** (`index.html`) — studio introduction with intro animation
- **Games** (`games.html`) — DJ Empire teaser
- **Team** (`team.html`) — leadership, management and development team
- **Contact** (`contact.html`) — contact form
- **Dashboard** (`/dashboard`) — Discord-login equity view for DJ Empire

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in your Discord OAuth app credentials:

```bash
cp .env.example .env
```

3. Start the server:

```bash
npm start
```

The site runs on `http://localhost:3000`.

## Discord OAuth

Create a Discord application at https://discord.com/developers/applications and set:

- Redirect URI: `http://localhost:3000/auth/discord/callback`
- Client ID and Client Secret into `.env`

## Deployment

### Render (recommended)

1. Go to https://dashboard.render.com/ and create a new **Web Service**.
2. Connect the `ashykxees/AeroPulse-Studios` GitHub repo.
3. Set the build command to `npm install` and start command to `node server.js`.
4. Add environment variables in the Render dashboard:
   - `DISCORD_CLIENT_ID`
   - `DISCORD_CLIENT_SECRET`
   - `DISCORD_CALLBACK_URL` (e.g. `https://your-service-name.onrender.com/auth/discord/callback`)
   - `SESSION_SECRET` (any random string)
5. Update your Discord app's redirect URI to match the Render URL.

### Fly.io

```bash
fly launch
fly deploy
```

Set the same environment variables in the Fly dashboard or with `fly secrets set`.

## Equity Dashboard

- Whitelisted Discord users log in via Discord OAuth.
- The admin (CEO, Discord ID `1440014645783035934`) can submit total DJ Empire earnings and assign user equity percentages.
- Each user sees their own equity % and calculated R$ earnings.

## Files

- `server.js` — Express server, Discord OAuth and equity API
- `whitelist.json` — list of allowed Discord user IDs
- `data.json` — runtime earnings/equity data (created at runtime, gitignored)
- `css/styles.css` — shared styles
- `js/main.js` — mobile menu, game filters, intro animation
