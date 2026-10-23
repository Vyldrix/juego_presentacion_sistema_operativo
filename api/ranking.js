const fs = require('fs');
const path = require('path');

// Credenciales directas de Upstash (evita restricciones de pago de Vercel)
const KV_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "https://organic-meerkat-236272.upstash.io";
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "gQAAAAAAA5rwAAIgcDFhMzFjY2QyYjY3MTg0NTRjYjFiOWUxNDczNjg2YjQwNQ";
const LOCAL_DATA_FILE = path.join(process.cwd(), 'ranking.json');

const INITIAL_SCORES = [
  { id: 'play_1792445065814_1ngil4', nombre: '11', puntos: 12655, nivel: 10, aciertos: 33, eviccionesCorrectas: 52, tasa: 89, duracion: 47, fecha: '2026-10-19T21:24:25.814Z' },
  { id: 'play_1792444325121_fwwqof', nombre: 'ssnk', puntos: 2820, nivel: 3, aciertos: 12, eviccionesCorrectas: 11, tasa: 68, duracion: 21, fecha: '2026-10-19T21:12:05.121Z' },
  { id: 'play_1792444296308_2nmqb4', nombre: 'ssnk', puntos: 2250, nivel: 3, aciertos: 6, eviccionesCorrectas: 11, tasa: 61, duracion: 20, fecha: '2026-10-19T21:11:36.308Z' },
  { id: 'play_1792444403947_3y2a6c', nombre: 'Franco', puntos: 100, nivel: 1, aciertos: 4, eviccionesCorrectas: 0, tasa: 27, duracion: 9, fecha: '2026-10-19T21:13:23.947Z' }
];

async function obtenerRankingNube() {
  if (KV_URL && KV_TOKEN) {
    try {
      const res = await fetch(`${KV_URL}/get/lrudefender_ranking`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
        cache: 'no-store'
      });
      if (res.ok) {
        const json = await res.json();
        if (json.result) {
          const parsed = typeof json.result === 'string' ? JSON.parse(json.result) : json.result;
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      }
    } catch (err) {
      console.warn('Error leyendo Upstash Redis:', err.message);
    }
  }

  // Fallback local en caso de pruebas offline
  try {
    if (fs.existsSync(LOCAL_DATA_FILE)) {
      const raw = fs.readFileSync(LOCAL_DATA_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch {}

  return INITIAL_SCORES;
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

  // Guardar copia local si el entorno lo permite
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

  // GET: Obtener ranking ordenado
  if (req.method === 'GET') {
    const ranking = await obtenerRankingNube();
    return res.status(200).json({
      ranking,
      source: 'upstash-redis',
      timestamp: Date.now()
    });
  }

  // POST: Agregar nuevo resultado o lista de resultados
  if (req.method === 'POST') {
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch {}
      }

      const incoming = Array.isArray(body)
        ? body
        : (body && body.ranking ? body.ranking : [body]);

      const current = await obtenerRankingNube();
      const map = new Map();

      // Fusionar asegurando unicidad por id (para no pisar resultados concurrentes de 30 personas)
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
