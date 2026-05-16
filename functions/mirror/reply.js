// POST /mirror/reply — proxy to omnimind on the Mac, queue to KV when down.
//
// When the Mac is up: forward to https://xen.xlrd.org/mirror/reply and return
// its response. When the Mac is down: enqueue the reply into PENDING_REPLIES
// KV with a fresh id and return { ok:true, queued:true, id }. The Mac drains
// this queue on next online check (see scripts/drain-pending-replies.js on
// the Mac side — not yet built).

export async function onRequestPost({ request, env }) {
  const origin = (env && env.ORIGIN_URL_BASE) || 'https://xen.xlrd.org';
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'bad json' }, 400);
  }

  try {
    const r = await fetch(origin + '/mirror/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    // Mac unreachable — queue for later replay.
    const id = crypto.randomUUID();
    if (env && env.PENDING_REPLIES) {
      const record = { id, body, queuedAt: Date.now(), error: String(err.message || err) };
      try { await env.PENDING_REPLIES.put('reply:' + id, JSON.stringify(record), { expirationTtl: 86400 * 7 }); } catch (_) {}
    }
    return json({ ok: true, queued: true, id, mac: 'offline' });
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
