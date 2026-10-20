# Estate Tycoon

## Deploy to Vercel

This project uses a Node.js server for its WebSocket multiplayer game. Vercel deploys the root `server.ts` entry point; `vercel.json` sets the function duration.

Create an Upstash Redis database and add its TLS Redis connection URL as the `UPSTASH_REDIS_URL` environment variable in the Vercel project. Use the Redis connection URL (the `rediss://` URL), not the REST URL or REST token. Redis stores room state and coordinates players connected to different function instances.

The same environment variable can be set locally to test the Redis-backed server. Without it, `npm start` uses in-memory room state for local development only.