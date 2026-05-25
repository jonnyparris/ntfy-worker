# ntfy-worker

A tiny, [ntfy.sh](https://ntfy.sh)-compatible publish/subscribe worker for
Cloudflare Workers + Durable Objects. About 100 lines of JavaScript. Each
topic gets its own Durable Object — subscribers connect over Server-Sent
Events, publishers POST a body with optional ntfy-style headers. Every
topic request requires a shared bearer token.

## Why

Public `ntfy.sh` is great but you may want:

- your own subdomain and rate limits
- topics that aren't shared globally
- auth, so random traffic can't publish or snoop
- a self-contained piece you can hack on

This worker is API-compatible enough that clients written against ntfy.sh
keep working — point them at your worker's URL and add an `Authorization`
header.

## Endpoints

| Method  | Path             | Auth | Behaviour                                       |
| ------- | ---------------- | ---- | ----------------------------------------------- |
| `POST`  | `/:topic`        | ✓    | Publish a message. Body is the message text.   |
| `GET`   | `/:topic`        | ✓    | Subscribe over Server-Sent Events.             |
| `GET`   | `/:topic/json`   | ✓    | Last 100 messages on the topic (in-memory).    |
| `GET`   | `/healthz`       | —    | Liveness check.                                 |
| `GET`   | `/version`       | —    | Build version + deploy timestamp.               |
| `GET`   | `/stats`         | —    | Light service stats.                            |

Topics are created lazily on first publish. The unauthenticated paths
exist so uptime checks and `/version` probes don't need the token.

## Auth

Every topic request must send:

```
Authorization: Bearer <NTFY_TOKEN>
```

`NTFY_TOKEN` is a shared secret bound to the worker. Both publishers and
subscribers use it. If the secret isn't configured the worker returns 503
on every topic request — there is no anonymous mode.

Set the token before first deploy:

```bash
# Generate a strong token
openssl rand -base64 32

# Store it in Cloudflare (paste the value at the prompt)
wrangler secret put NTFY_TOKEN
```

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in
a value. `.dev.vars` is gitignored.

Rotate by running `wrangler secret put NTFY_TOKEN` again. All clients have
to update at the same time — there's intentionally no rolling window.

## ntfy headers

Recognised on `POST`:

`X-Title`, `X-Priority`, `X-Tags`, `X-Click`, `X-Actions`, `X-Markdown`,
`X-Icon`, `X-Attach`.

Each is also accepted without the `X-` prefix (`Title`, `Priority`,
etc.) — public ntfy.sh works this way, and clients in the wild send
both forms. The `X-` form wins when both are present.

## Quick start

```bash
git clone https://github.com/jonnyparris/ntfy-worker.git
cd ntfy-worker
npm install
wrangler secret put NTFY_TOKEN     # paste a strong random value
npm run deploy
```

Publish a message:

```bash
TOKEN="..."  # the value you set above
curl -d "hello world" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Title: greetings" \
     https://ntfy-worker.<your-subdomain>.workers.dev/my-topic
```

Subscribe from another terminal:

```bash
curl -H "Authorization: Bearer $TOKEN" \
     https://ntfy-worker.<your-subdomain>.workers.dev/my-topic
```

## Use with Dodo

[Dodo](https://github.com/cloudflare/dodo) fires push notifications when
worker runs change state. Two env vars:

- `NTFY_BASE_URL` — your deployed worker URL, e.g.
  `https://ntfy-worker.<your-subdomain>.workers.dev`
- `NTFY_TOKEN` — the bearer token

Dodo sends `Authorization: Bearer ${NTFY_TOKEN}` on every publish.

## Storage caveat

History and subscriber state live in the Durable Object's memory. They
survive idle eviction (the DO rehydrates) but not deliberate deletion or
the in-memory ring being trimmed past 100 messages. If you want durable
history, swap `this.history` for `this.state.storage.put(...)`.

## License

MIT.
