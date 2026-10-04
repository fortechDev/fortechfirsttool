/* ============================================================
   FORTECH FIRST TOOLS — API: Pinterest Downloader
   Endpoint : POST /api/pinterest
   Body     : { url }
   Metode   : Multi-provider fallback (3 sumber)
   ============================================================ */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

/* ---------- CORS ---------- */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

/* ---------- Extract pin ID ---------- */
function extractPinId(url) {
  let m = url.match(/\/pin\/(\d+)/);
  if (m) return m[1];
  m = url.match(/--(\d+)\/?/);
  if (m) return m[1];
  return null;
}

/* ---------- Normalize URL ---------- */
function normalizeUrl(u) {
  if (!u) return null;
  if (u.startsWith('http')) return u;
  return 'https://www.pinterest.com' + u;
}

/* ============================================================
   PROVIDER 1 — cedds-api.duckdns.org
   ============================================================ */
async function providerCedds(url) {
  const apiUrl = `https://cedds-api.duckdns.org/downloader/pintedl?url=${encodeURIComponent(url)}`;
  const res = await fetch(apiUrl, {
    method: 'GET',
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`cedds HTTP ${res.status}`);
  const json = await res.json();
  if (!json.success || !json.data) throw new Error('cedds: data kosong');

  const d = json.data;
  const downloads = d.downloads || [];
  const videoDl = downloads.find(x => x.type === 'video');
  const imageDl = downloads.find(x => x.type === 'image');

  return {
    id: d.pin_id || '',
    title: d.title || 'Pinterest Pin',
    description: '',
    type: videoDl ? 'video' : 'image',
    image: imageDl?.url || d.thumbnail || null,
    video: videoDl?.url || null,
    pinner: { username: '-', fullName: '-', avatar: null },
    board: { name: '-', url: null },
    link: d.source_url || null,
    saves: 0,
    comments: 0
  };
}

/* ============================================================
   PROVIDER 2 — majidapi.ir
   ============================================================ */
async function providerMajid(url) {
  const apiUrl = `https://api.majidapi.ir/social/pinterest?action=download&url=${encodeURIComponent(url)}`;
  const res = await fetch(apiUrl, {
    method: 'GET',
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`majid HTTP ${res.status}`);
  const json = await res.json();
  if (!json.success && !json.data) throw new Error('majid: data kosong');

  const d = json.data || json.result || json;
  const isVideo = !!(d.video || d.video_url);
  const imageUrl = d.image || d.image_url || d.thumbnail || null;

  return {
    id: d.id || extractPinId(url) || '',
    title: d.title || 'Pinterest Pin',
    description: d.description || '',
    type: isVideo ? 'video' : 'image',
    image: imageUrl,
    video: d.video || d.video_url || null,
    pinner: { username: '-', fullName: '-', avatar: null },
    board: { name: '-', url: null },
    link: url,
    saves: 0,
    comments: 0
  };
}

/* ============================================================
   PROVIDER 3 — Pinterest oEmbed + image CDN (last resort)
   ============================================================ */
async function providerOembed(url) {
  const pinId = extractPinId(url);
  if (!pinId) throw new Error('oembed: pin id tidak ditemukan');

  const oembedUrl = `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(`https://www.pinterest.com/pin/${pinId}/`)}`;
  const res = await fetch(oembedUrl, {
    method: 'GET',
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`oembed HTTP ${res.status}`);
  const json = await res.json();

  /* Image URL fallback pakai CDN pola pinimg */
  const imageUrl = `https://i.pinimg.com/736x/${pinId.slice(-6, -3)}/${pinId.slice(-3)}/${pinId}.jpg`;

  return {
    id: pinId,
    title: json.title || 'Pinterest Pin',
    description: json.description || '',
    type: 'image',
    image: json.thumbnail_url || imageUrl,
    video: null,
    pinner: {
      username: json.author_name || '-',
      fullName: json.author_name || '-',
      avatar: json.author_url || null
    },
    board: { name: '-', url: json.provider_url || null },
    link: url,
    saves: 0,
    comments: 0
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
    let url = String(body.url || '').trim();

    if (!url) {
      return res.status(400).json({ success: false, error: 'URL Pinterest wajib diisi.' });
    }
    if (!/pinterest\.|pin\.it/i.test(url)) {
      return res.status(400).json({ success: false, error: 'URL Pinterest tidak valid.' });
    }

    /* Daftar provider — dicoba berurutan */
    const providers = [
      { name: 'cedds', fn: providerCedds },
      { name: 'majid', fn: providerMajid },
      { name: 'oembed', fn: providerOembed }
    ];

    const errors = [];
    let result = null;
    let usedProvider = null;

    for (const p of providers) {
      try {
        console.log(`[pinterest] trying provider: ${p.name}`);
        const data = await p.fn(url);
        if (data && (data.image || data.video)) {
          result = data;
          usedProvider = p.name;
          break;
        }
        errors.push(`${p.name}: data kosong`);
      } catch (e) {
        console.warn(`[pinterest] provider ${p.name} gagal:`, e.message);
        errors.push(`${p.name}: ${e.message}`);
      }
    }

    if (!result) {
      return res.status(500).json({
        success: false,
        error: 'Semua provider gagal mengambil data. Detail: ' + errors.join(' | ')
      });
    }

    console.log(`[pinterest] sukses via provider: ${usedProvider}`);

    return res.status(200).json({
      success: true,
      data: {
        ...result,
        provider: usedProvider
      }
    });

  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Terjadi kesalahan di server.';
    console.error('[pinterest] error:', msg);
    return res.status(500).json({ success: false, error: msg });
  }
};
