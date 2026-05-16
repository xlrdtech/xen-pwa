// /events — SSE relay that keeps the stream open even when the Mac dies.
//
// Behavior:
//   1. Open a ReadableStream to the client immediately. The stream stays
//      open until the CLIENT disconnects, not the upstream. This is what
//      kept the old direct-to-omnimind /events from "STAYing TF ON" —
//      whenever cloudflared dropped the origin, the client SSE died too.
//   2. Internally, connect upstream to https://xen.xlrd.org/events (or
//      ORIGIN_URL env). When upstream gives us data, pipe it through.
//      When upstream drops, emit a `mac-offline` heartbeat every 5s and
//      keep retrying upstream silently. Client never notices.
//   3. Inject a leading `: connected\n\n` so EventSource fires onopen
//      even if upstream hasn't sent anything yet.

export async function onRequestGet({ request, env }) {
  const upstream = (env && env.ORIGIN_URL) || 'https://xen.xlrd.org/events';
  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  };

  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (chunk) => { if (!closed) try { controller.enqueue(enc.encode(chunk)); } catch (_) { closed = true; } };

      send(': connected\n\n');

      const heartbeat = setInterval(() => send(`: heartbeat ${Date.now()}\n\n`), 15000);

      let attempt = 0;
      const connectUpstream = async () => {
        while (!closed) {
          attempt += 1;
          try {
            const r = await fetch(upstream, {
              headers: { 'Accept': 'text/event-stream' },
              cf: { cacheTtl: 0, cacheEverything: false },
            });
            if (!r.ok || !r.body) throw new Error('upstream ' + r.status);
            send(`event: mac-online\ndata: {"attempt":${attempt}}\n\n`);
            const reader = r.body.getReader();
            const dec = new TextDecoder();
            while (!closed) {
              const { value, done } = await reader.read();
              if (done) break;
              send(dec.decode(value, { stream: true }));
            }
            send(`event: mac-disconnect\ndata: {"attempt":${attempt}}\n\n`);
          } catch (err) {
            send(`event: mac-offline\ndata: ${JSON.stringify({ attempt, err: String(err && err.message || err) })}\n\n`);
            // Back off: 1s, 2s, 4s, 8s, cap 30s.
            const wait = Math.min(30000, 1000 * Math.pow(2, Math.min(attempt, 5)));
            await new Promise(res => setTimeout(res, wait));
          }
        }
      };

      // Client disconnect — release everything.
      request.signal.addEventListener('abort', () => {
        closed = true;
        clearInterval(heartbeat);
        try { controller.close(); } catch (_) {}
      });

      // Fire upstream loop in the background; the controller is the keep-alive.
      connectUpstream().catch(() => {});
    },
  });

  return new Response(stream, { headers });
}
