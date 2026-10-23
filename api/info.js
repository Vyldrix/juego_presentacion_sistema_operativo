module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  res.status(200).json({
    platform: 'vercel',
    networkUrl: `${proto}://${host}`,
    hasKvConfigured: !!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)
  });
};
