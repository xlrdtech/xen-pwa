// POST /api/gate-entry — log the (name, phone) gate-entry on the Mac.
// Mac-down: persist to GATE_LOG KV so qi can drain later.

export async function onRequestPost({ request, env }) {
  const origin = (env && env.ORIGIN_URL_BASE) || 'https://xen.xlrd.org';
  let body;
  try { body = await request.json(); } catch { body = {}; }

  try {
    const r = await fetch(origin + '/api/gate-entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (err) {
    if (env && env.GATE_LOG) {
      const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      try {
        await env.GATE_LOG.put('gate:' + id, JSON.stringify({
          id, ...body, ua: request.headers.get('user-agent'), cf: request.cf, queuedAt: Date.now(),
        }), { expirationTtl: 86400 * 30 });
      } catch (_) {}
    }
    return new Response(JSON.stringify({ ok: true, queued: true, mac: 'offline' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
