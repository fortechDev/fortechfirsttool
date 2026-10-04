/* ============================================================
   FORTECH FIRST TOOLS — API: URL Shortener
   Endpoint : POST /api/shorturl
   Body     : { url, alias }
   Providers: is.gd → v.gd → TinyURL (fallback)
   ============================================================ */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

/* ---------- CORS ---------- */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

/* ---------- Validasi URL ---------- */
function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/* ---------- Sanitasi alias ---------- */
function sanitizeAlias(str) {
  return String(str || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 30);
}

/* ============================================================
   PROVIDER 1 & 2 — is.gd / v.gd (support custom alias)
   ============================================================ */
async function shortenIsgd(url, alias, domain = 'is.gd') {
  let apiUrl = `https://${domain}/create.php?format=json&url=${encodeURIComponent(url)}`;
  if (alias) apiUrl += `&shorturl=${encodeURIComponent(alias)}`;

  const res = await fetch(apiUrl, {
    method: 'GET',
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  });

  if (!res.ok) throw new Error(`${domain} HTTP ${res.status}`);

  const json = await res.json();

  if (json.errorcode) {
    throw new Error(json.errormessage || `${domain}: error ${json.errorcode}`);
  }
  if (!json.shorturl) {
    throw new Error(`${domain}: response tidak berisi shorturl`);
  }

  return {
    short: json.shorturl,
    long: url,
    provider: domain,
    alias: alias || null
  };
}

/* ============================================================
   PROVIDER 3 — TinyURL (fallback, tanpa alias)
   ============================================================ */
async function shortenTinyURL(url) {
  const apiUrl = `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`;
  const res = await fetch(apiUrl, {
    method: 'GET',
    headers: { 'User-Agent': UA, 'Accept': 'text/plain' }
  });

  if (!res.ok) throw new Error(`tinyurl HTTP ${res.status}`);

  const text = (await res.text()).trim();

  if (!text.startsWith('http')) {
    throw new Error('tinyurl: response tidak valid');
  }

  return {
    short: text,
    long: url,
    provider: 'tinyurl',
    alias: null
  };
}

/* ============================================================
   HANDLER
   ============================================================ */
module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Gunakan POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const url = String(body.url || '').trim();
    const alias = sanitizeAlias(body.alias);

    if (!url) {
      return res.status(400).json({ success: false, error: 'URL wajib diisi.' });
    }
    if (!isValidUrl(url)) {
      return res.status(400).json({ success: false, error: 'URL tidak valid. Harus diawali http:// atau https://' });
    }
    if (url.length > 2000) {
      return res.status(400).json({ success: false, error: 'URL terlalu panjang (maks 2000 karakter).' });
    }

    /* Provider list — dicoba berurutan */
    const providers = [
      { name: 'is.gd',  fn: () => shortenIsgd(url, alias, 'is.gd') },
      { name: 'v.gd',   fn: () => shortenIsgd(url, alias, 'v.gd') },
      { name: 'tinyurl', fn: () => shortenTinyURL(url) }
    ];

    const errors = [];
    let result = null;

    for (const p of providers) {
      try {
        console.log(`[shorturl] trying provider: ${p.name}`);
        result = await p.fn();
        break;
      } catch (e) {
        console.warn(`[shorturl] provider ${p.name} gagal:`, e.message);
        errors.push(`${p.name}: ${e.message}`);
      }
    }

    if (!result) {
      return res.status(500).json({
        success: false,
        error: 'Semua provider gagal: ' + errors.join(' | ')
      });
    }

    /* Info tambahan */
    const shortLen = result.short.length;
    const saved = url.length - shortLen;

    return res.status(200).json({
      success: true,
      data: {
        short: result.short,
        long: result.long,
        provider: result.provider,
        alias: result.alias,
        stats: {
          originalLength: url.length,
          shortLength: shortLen,
          savedChars: saved > 0 ? saved : 0
        }
      }
    });

  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Terjadi kesalahan di server.';
    console.error('[shorturl] error:', msg);
    return res.status(500).json({ success: false, error: msg });
  }
};
