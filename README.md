# Signalist – Stock Market Dashboard

Signalist is a modern stock market dashboard built with Next.js App Router. It features a fast command-palette search, TradingView widgets, watchlist UI, and a clean dark theme.

## Features
- **Search palette**: Debounced search with manual trigger via `/api/search`.
- **Home**: Market overview, heatmap, quotes, and timeline widgets.
- **Stock details**: Symbol info, advanced candle/baseline charts, technical analysis, profile, and financials.
- **Watchlist button**: Quick toggle per symbol (UI-only stub).
- **Auth-ready middleware**: Edge-safe check based on auth cookie.
- **SEO**: OpenGraph + Twitter cards with a cover image.

## Tech stack
- Next.js 15 (App Router, Turbopack)
- TypeScript
- TradingView embedded widgets
- cmdk (command palette)

## Getting started
1. Install dependencies
```bash
npm i
```
2. Dev server
```bash
npm run dev
```
3. Open http://localhost:3000

## Environment variables
Create `.env` with at least:
```
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_FINNHUB_API_KEY=your_key
FINNHUB_API_KEY=your_key
MONGODB_URI=your_mongodb_uri
```

## Scripts
- `npm run dev` – start dev server
- `npm run build` – build for production
- `npm start` – run production server

## SEO
Global metadata is set in `src/app/layout.tsx`:
- Title template, description, keywords
- OpenGraph and Twitter with image
- Robots and canonical

Cover image used:
```
https://res.cloudinary.com/dawvvzwyw/image/upload/v1760788029/WhatsApp_Image_2025-10-18_at_17.16.55_1cadd301_amqxpd.jpg
```

## API
- `GET /api/search?q=TERM` → `{ results: StockWithWatchlistStatus[] }`

## Deployment
- Ensure env variables exist on the platform.
- Middleware is edge-safe. If you need to disable auth redirects temporarily, adjust `matcher` in `middleware.ts`.

## Troubleshooting
- 500 `MIDDLEWARE_INVOCATION_FAILED`: make sure no server-only APIs are called in middleware.
- Client import of server-only actions: use API routes from client components.

---
MIT License
