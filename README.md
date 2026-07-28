# AeroPulse Studios

A static website for AeroPulse Studios, an independent game studio.

## Pages

- **Home** (`index.html`) — studio introduction and featured games
- **Games** (`games.html`) — full game catalog with thumbnails and status filters
- **Team** (`team.html`) — leadership team with Discord profile pictures
- **Contact** (`contact.html`) — contact form and inquiry options

## Structure

```
AeroPulse-Studios/
├── index.html
├── games.html
├── team.html
├── contact.html
├── css/
│   └── styles.css
├── js/
│   └── main.js
└── images/
    ├── hero-bg.jpg
    ├── game-1.jpg ... game-4.jpg
    ├── team-ceo.png
    └── team-coo.png
```

## Local Development

Open any `.html` file in a browser, or run a local server:

```bash
python3 -m http.server 8000
```

## Deployment

The site is static and can be deployed to GitHub Pages by enabling Pages from the `main` branch root.
