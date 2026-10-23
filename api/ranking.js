const fs = require('fs');
const path = require('path');

const KV_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "https://organic-meerkat-236272.upstash.io";
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "gQAAAAAAA5rwAAIgcDFhMzFjY2QyYjY3MTg0NTRjYjFiOWUxNDczNjg2YjQwNQ";
const LOCAL_DATA_FILE = path.join(process.cwd(), 'ranking.json');

async function obtenerRankingNube() {
  if (KV_URL && KV_TOKEN) {
    try {
      const res = await fetch(`${KV_URL}/get/lrudefender_ranking`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
        cache: 'no-store'
      });
      if (res.ok) {
        const json = await res.json();
        if (json.result !== null && json.result !== undefined) {
          const parsed = typeof json.result === 'string' ? JSON.parse(json.result) : json.result;
          if (Array.isArray(parsed)) return parsed;
        }
      }
    } catch (err) {
      console.warn('Error leyendo Upstash Redis:', err.message);
    }
  }

  // Fallback a ranking.json local
  try {
    if (fs.existsSync(LOCAL_DATA_FILE)) {
      const raw = fs.readFileSync(LOCAL_DATA_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data;
    }
  } catch {}

  return [];
}

async function guardarRankingNube(ranking) {
  if (KV_URL && KV_TOKEN) {
    try {
      const res = await fetch(KV_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${KV_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['SET', 'lrudefender_ranking', JSON.stringify(ranking)])
      });
      if (res.ok) return true;
    } catch (err) {
      console.warn('Error escribiendo en Upstash Redis:', err.message);
    }
  }

  try {
    fs.writeFileSync(LOCAL_DATA_FILE, JSON.stringify(ranking, null, 2), 'utf8');
  } catch {}

  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Reset del ranking
  const urlObj = new URL(req.url, 'http://localhost');
  if (urlObj.searchParams.get('action') === 'reset' || req.query?.action === 'reset') {
    await guardarRankingNube([]);
    return res.status(200).json({ ok: true, count: 0, ranking: [] });
  }

  // GET: Obtener ranking
  if (req.method === 'GET') {
    const ranking = await obtenerRankingNube();
    return res.status(200).json({
      ranking,
      source: 'upstash-redis',
      timestamp: Date.now()
    });
  }

  // POST: Agregar nuevo resultado
  if (req.method === 'POST') {
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch {}
      }

      if (body && (body.action === 'reset' || body.reset === true)) {
        await guardarRankingNube([]);
        return res.status(200).json({ ok: true, count: 0, ranking: [] });
      }

      const incoming = Array.isArray(body)
        ? body
        : (body && body.ranking ? body.ranking : [body]);

      const current = await obtenerRankingNube();
      const map = new Map();

      current.forEach(item => { if (item && item.id) map.set(item.id, item); });
      incoming.forEach(item => { if (item && item.id) map.set(item.id, item); });

      const merged = Array.from(map.values());
      merged.sort((a, b) =>
        b.puntos !== a.puntos ? b.puntos - a.puntos :
        b.tasa !== a.tasa ? b.tasa - a.tasa :
        a.duracion - b.duracion
      );

      const top100 = merged.slice(0, 100);
      await guardarRankingNube(top100);

      return res.status(200).json({
        ok: true,
        count: top100.length,
        ranking: top100,
        source: 'upstash-redis'
      });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
