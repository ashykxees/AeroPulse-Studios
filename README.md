# AeroPulse Studios

A static website for AeroPulse Studios, an independent game studio, with a Discord-OAuth equity dashboard.

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
