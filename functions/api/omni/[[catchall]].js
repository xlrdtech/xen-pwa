// /api/omni/* — proxy to omnimind, cache GET results in OMNI_CACHE KV so
// the dashboards still show the last-known threads / messages when the Mac
// is offline. Writes (POST /api/omni/send, /event) fall back to the same
// queue pattern as /mirror/reply.

export async function onRequest({ request, env, params }) {
  const origin = (env && env.ORIGIN_URL_BASE) || 'https://xen.xlrd.org';
  const url = new URL(request.url);
  const upstreamUrl = origin + url.pathname + (url.search || '');

  if (request.method === 'GET') {
    // Sort query params so /threads?a=1&b=2 and /threads?b=2&a=1 hit the
    // same cache entry. Without this two callers asking for identical data
    // with differently-ordered params would each cause an upstream fetch +
    // separate KV write.
    const sortedParams = new URLSearchParams([...url.searchParams.entries()].sort());
    const sortedSearch = sortedParams.toString();
    const cacheKey = 'omni:' + url.pathname + (sortedSearch ? '?' + sortedSearch : '');
    try {
      const r = await fetch(upstreamUrl, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) throw new Error('upstream ' + r.status);
      const text = await r.text();
      if (env && env.OMNI_CACHE) {
        try { await env.OMNI_CACHE.put(cacheKey, text, { expirationTtl: 86400 }); } catch (_) {}
      }
      return new Response(text, {
        status: 200,
        headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json', 'Access-Control-Allow-Origin': '*', 'X-Source': 'mac-live' },
      });
    } catch (err) {
      // Serve last-known cache.
      if (env && env.OMNI_CACHE) {
        const cached = await env.OMNI_CACHE.get(cacheKey);
        if (cached) {
          return new Response(cached, {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'X-Source': 'kv-cache', 'X-Mac-Status': 'offline' },
          });
        }
      }
      return json({ ok: false, error: 'mac offline + no cache', detail: String(err.message || err) }, 503);
    }
  }

  if (request.method === 'POST') {
    const body = await request.text();
    try {
      const r = await fetch(upstreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': request.headers.get('Content-Type') || 'application/json' },
        body,
        signal: AbortSignal.timeout(8000),
      });
      const text = await r.text();
      return new Response(text, {
        status: r.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    } catch (err) {
      const id = crypto.randomUUID();
      if (env && env.PENDING_OMNI) {
        try {
          await env.PENDING_OMNI.put('omni:' + id, JSON.stringify({
            id, path: url.pathname, body, queuedAt: Date.now(),
          }), { expirationTtl: 86400 * 7 });
        } catch (_) {}
      }
      return json({ ok: true, queued: true, id, mac: 'offline' });
    }
  }

  return json({ ok: false, error: 'method not allowed' }, 405);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
