const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'ranking.json');

// Obtener la IP local de la red para que los celulares se conecten fácilmente
function getLocalIp() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        // Descartar adaptadores virtuales tipo WSL/Hyper-V si hay físicos disponibles
        const isVirtual = /wsl|hyper-v|virtual|veth/i.test(name);
        candidates.push({ ip: net.address, isVirtual });
      }
    }
  }
  const preferred = candidates.find(c => !c.isVirtual);
  return preferred ? preferred.ip : (candidates[0] ? candidates[0].ip : '127.0.0.1');
}

const LOCAL_IP = getLocalIp();

// Carga inicial y persistencia del ranking
function cargarRanking() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.error('⚠️ Error leyendo ranking.json:', err.message);
  }
  return [];
}

function guardarRanking(ranking) {
  try {
    const tmpFile = DATA_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(ranking, null, 2), 'utf8');
    fs.renameSync(tmpFile, DATA_FILE);
    return true;
  } catch (err) {
    console.error('⚠️ Error guardando ranking.json:', err.message);
    return false;
  }
}

let rankingCache = cargarRanking();

// Clientes SSE conectados en tiempo real
const sseClients = new Set();

function notificarSSEClients(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// Heartbeat para mantener vivas las conexiones SSE en celulares
setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(':ping\n\n');
    } catch {
      sseClients.delete(client);
    }
  }
}, 15000);

// MIME types para archivos estáticos
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Servidor HTTP
const server = http.createServer((req, res) => {
  // Configuración de CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  // ==========================================
  // RUTAS DE LA API
  // ==========================================

  // Información del servidor (para que el frontend conozca la URL de red)
  if (pathname === '/api/info' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
    res.end(JSON.stringify({
      localIp: LOCAL_IP,
      port: PORT,
      networkUrl: `http://${LOCAL_IP}:${PORT}`,
      activePlayersConnected: sseClients.size
    }));
    return;
  }

  // Canal en tiempo real (Server-Sent Events)
  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(`data: ${JSON.stringify({ type: 'init', ranking: rankingCache })}\n\n`);
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // Obtener ranking actual
  if (pathname === '/api/ranking' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
    res.end(JSON.stringify({ ranking: rankingCache }));
    return;
  }

  // Guardar nuevo puntaje o lista de puntajes
  if (pathname === '/api/ranking' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const incoming = Array.isArray(parsed) ? parsed : (parsed.ranking ? parsed.ranking : [parsed]);

        const map = new Map();
        // Cargar registros existentes
        rankingCache.forEach(item => { if (item && item.id) map.set(item.id, item); });

        // Agregar nuevos registros
        incoming.forEach(item => {
          if (item && item.id) {
            map.set(item.id, item);
          }
        });

        const merged = Array.from(map.values());
        merged.sort((a, b) =>
          b.puntos !== a.puntos ? b.puntos - a.puntos :
          b.tasa !== a.tasa ? b.tasa - a.tasa :
          a.duracion - b.duracion
        );

        rankingCache = merged.slice(0, 100);
        guardarRanking(rankingCache);

        // Notificar en tiempo real a todos los clientes (celulares + proyector)
        notificarSSEClients({ type: 'ranking_update', ranking: rankingCache });

        res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ ok: true, count: rankingCache.length }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // Reiniciar ranking (para reiniciar torneo si se desea)
  if (pathname === '/api/ranking/reset' && req.method === 'POST') {
    rankingCache = [];
    guardarRanking(rankingCache);
    notificarSSEClients({ type: 'ranking_update', ranking: rankingCache });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
    res.end(JSON.stringify({ ok: true, message: 'Ranking reiniciado' }));
    return;
  }

  // ==========================================
  // SERVIR ARCHIVOS ESTÁTICOS
  // ==========================================
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  // Seguridad para evitar Directory Traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Acceso denegado');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
      res.end('Archivo no encontrado');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n=============================================================');
  console.log('⚡ LRU DEFENDER — Servidor de Juego y Sincronización en Vivo');
  console.log('=============================================================');
  console.log(`👉 En esta PC:     http://localhost:${PORT}`);
  console.log(`📱 En celulares:   http://${LOCAL_IP}:${PORT}`);
  console.log('-------------------------------------------------------------');
  console.log('Persistencia:      ranking.json (permanente)');
  console.log('Tiempo real:       Server-Sent Events (SSE activo)');
  console.log('=============================================================\n');
});
