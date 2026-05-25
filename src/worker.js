/**
 * ntfy-worker — a tiny, ntfy.sh-compatible publish/subscribe worker.
 *
 * Endpoints
 * ---------
 *   POST /:topic   Publish a message. Headers map to ntfy.sh:
 *                  X-Title, X-Priority, X-Tags, X-Click, X-Actions,
 *                  X-Markdown, X-Icon, X-Attach.
 *   GET  /:topic   Subscribe to live messages over SSE.
 *   GET  /:topic/json   Topic history (last 100 messages, in-memory).
 *   GET  /healthz  Liveness check (no auth).
 *   GET  /version  Returns build version + deploy timestamp (no auth).
 *   GET  /stats    Light service stats (no auth).
 *
 * Auth
 * ----
 * Topic routes (publish, subscribe, history) require a bearer token:
 *     Authorization: Bearer <NTFY_TOKEN>
 * The expected token is read from the `NTFY_TOKEN` secret binding.
 * Set it with `wrangler secret put NTFY_TOKEN`.
 *
 * If `NTFY_TOKEN` is unset the worker refuses every topic request with
 * 503 — there is no anonymous mode. The unauthenticated paths above
 * stay open so external uptime checks keep working.
 *
 * State lives in a Durable Object per topic, so history and subscriber
 * lists are isolated by topic but globally consistent across requests.
 */

const VERSION = "1.3.0";
const DEPLOYED_AT = "2026-04-26T09:13:53.838Z";

/** Constant-time string compare. Both inputs are coerced to UTF-8 bytes. */
function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function unauthorized(reason) {
  return new Response(JSON.stringify({ error: reason }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": 'Bearer realm="ntfy-worker"',
    },
  });
}

/** Returns null when auth passes, or a Response to short-circuit. */
function checkAuth(request, env) {
  if (!env.NTFY_TOKEN) {
    return new Response(
      JSON.stringify({
        error: "NTFY_TOKEN secret is not configured on this worker",
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }
  const header = request.headers.get("authorization");
  if (!header) return unauthorized("missing Authorization header");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return unauthorized("expected Bearer token");
  if (!timingSafeEqual(match[1].trim(), env.NTFY_TOKEN)) {
    return unauthorized("invalid token");
  }
  return null;
}

export class TopicRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.subscribers = new Set();
    this.history = [];
  }

  async fetch(request) {
    const url = new URL(request.url);
    const topic = url.pathname.split("/")[1];

    if (request.method === "POST" || request.method === "PUT") {
      const body = await request.text();
      const msg = {
        id: crypto.randomUUID(),
        time: Math.floor(Date.now() / 1000),
        event: "message",
        topic,
        title: request.headers.get("X-Title"),
        message: body,
        priority: request.headers.get("X-Priority"),
        tags: request.headers.get("X-Tags"),
        click: request.headers.get("X-Click"),
        actions: request.headers.get("X-Actions"),
        markdown: request.headers.get("X-Markdown"),
        icon: request.headers.get("X-Icon"),
        attachment: request.headers.get("X-Attach"),
      };
      this.history.push(msg);
      if (this.history.length > 100) this.history.shift();
      for (const sub of this.subscribers) {
        try {
          sub.write("data: " + JSON.stringify(msg) + "\n\n");
        } catch {
          // Subscriber went away; cleanup happens lazily.
        }
      }
      return Response.json({ id: msg.id, time: msg.time });
    }

    if (url.searchParams.get("json") === "1" || url.pathname.endsWith("/json")) {
      return Response.json(this.history);
    }

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const sub = {
      write: (data) => writer.write(encoder.encode(data)),
    };
    this.subscribers.add(sub);
    return new Response(readable, {
      headers: { "content-type": "text/event-stream" },
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Unauthenticated meta endpoints — safe for uptime checks and version probes.
    if (url.pathname === "/healthz") {
      return Response.json({ ok: true, service: "ntfy-worker" });
    }
    if (url.pathname === "/version") {
      return Response.json({ version: VERSION, deployedAt: DEPLOYED_AT });
    }
    if (url.pathname === "/stats") {
      return Response.json({
        version: VERSION,
        uptime: "unknown",
        timestamp: new Date().toISOString(),
      });
    }

    // Everything else hits a topic — gate it behind the bearer token.
    const authFail = checkAuth(request, env);
    if (authFail) return authFail;

    const topic = url.pathname.split("/")[1] || "default";
    const id = env.TOPIC_ROOM.idFromName(topic);
    const stub = env.TOPIC_ROOM.get(id);
    return stub.fetch(request);
  },
};
