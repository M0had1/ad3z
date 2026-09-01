# Replit setup

## Run the app

Use the configured **Start application** workflow. It runs:

```bash
PORT=5000 npm run dev
```

The `dev` script binds Rsbuild to `0.0.0.0` and uses `PORT` when provided. Outside Replit, `npm run dev` defaults to port `4003`.

## Environment

The app reads its build-time Deriv configuration from `.env.production`. `NEXT_PUBLIC_DERIV_APP_ID` is required for Deriv login and WebSocket features. Google Drive variables are optional.

## Checks

```bash
npm run type-check
npm run build
```