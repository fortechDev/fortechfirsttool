/* ============================================================
   FORTECH FIRST TOOLS — API: Pinterest Downloader
   Endpoint : POST /api/pinterest
   Body     : { url }
   Metode   : Pinterest internal PinResource API
   ============================================================ */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

/* ---------- CORS ---------- */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

/* ---------- Extract pin ID dari berbagai bentuk URL ---------- */
function extractPinId(url) {
  // Format: /pin/1234567890/
  let m = url.match(/\/pin\/(\d+)/);
  if (m) return m[1];
  // Format: /pin/some-slug--1234567890/
  m = url.match(/--(\d+)\/?/);
  if (m) return m[1];
  // Format: pin.it/xxxxx (shortlink)
  return null;
}

/* ---------- Resolve shortlink pin.it ---------- */
async function resolveShortlink(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': UA },
      redirect: 'follow'
    });
    return res.url || url;
  } catch {
    return url;
  }
}

/* ---------- Fetch pin detail ---------- */
async function fetchPinData(pinId, attempt = 1) {
  const sourceUrl = `/pin/${pinId}/`;
  const options = {
    id: pinId,
    field_set_key: 'detailed',
    fetch_visual_search_objects: true
  };

  const apiUrl = `https://www.pinterest.com/resource/PinResource/get/?source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(JSON.stringify({ options, context: {} }))}`;

  const res = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'en-US,en;q=0.9',
      'X-Requested-With': 'XMLHttpRequest',
      'X-APP-VERSION': 'cb1c9b5',
      'X-Pinterest-AppState': 'active',
      'Referer': `https://www.pinterest.com${sourceUrl}`
    }
  });

  if ((res.status === 403 || res.status === 429) && attempt < 3) {
    await new Promise(r => setTimeout(r, 800 * attempt));
    return fetchPinData(pinId, attempt + 1);
  }

  if (!res.ok) throw new Error(`Pinterest HTTP ${res.status}`);

  const json = await res.json();
  const data = json && json.resource_response && json.resource_response.data;
  if (!data || !data.id) {
    throw new Error('Pin tidak ditemukan atau tidak bisa diakses.');
  }
  return data;
}

/* ---------- Pilih image kualitas terbaik ---------- */
function pickBestImage(images) {
  if (!images) return null;
  const order = ['orig', 'originals', '736x', '564x', '474x', '236x'];
  for (const key of order) {
    if (images[key] && images[key].url) return images[key].url;
  }
  // fallback: key pertama
  const first = Object.keys(images)[0];
  return first ? images[first].url : null;
}

/* ---------- Handler ---------- */
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

    /* Resolve shortlink dulu */
    if (/pin\.it/i.test(url)) {
      url = await resolveShortlink(url);
    }

    const pinId = extractPinId(url);
    if (!pinId) {
      return res.status(400).json({ success: false, error: 'Tidak bisa menemukan ID pin dari URL.' });
    }

    const pin = await fetchPinData(pinId);

    /* Tentukan tipe media */
    const isVideo = !!pin.videos || (pin.story_pin_data && pin.story_pin_data.pages) || pin.video_status === 'finished';
    const images = pin.images || {};

    /* Ambil URL video kalau ada */
    let videoUrl = null;
    if (pin.videos) {
      videoUrl = pin.videos.V_HLSV4?.url ||
                 pin.videos.V_HLSV3?.url ||
                 pin.videos.V_720P?.url ||
                 pin.videos.V_480P?.url ||
                 pin.videos.V_EXPMP4_720P?.url ||
                 null;
    }

    /* Image utama */
    const imageUrl = pickBestImage(images) || pin.image_large_url || null;

    /* Metadata */
    const pinner = pin.pinner || {};
    const board = pin.board || {};

    return res.status(200).json({
      success: true,
      data: {
        id: pin.id || pinId,
        title: pin.title || pin.grid_title || pin.description || 'Pinterest Pin',
        description: pin.description || '',
        type: isVideo ? 'video' : 'image',
        image: imageUrl,
        video: videoUrl,
        pinner: {
          username: pinner.username || '-',
          fullName: pinner.full_name || '-',
          avatar: pinner.image_small_url || pinner.image_xlarge_url || null
        },
        board: {
          name: board.name || '-',
          url: board.url || null
        },
        link: pin.link || null,
        saves: pin.repin_count || 0,
        comments: pin.comment_count || 0,
        createdAt: pin.created_at || null
      }
    });

  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Terjadi kesalahan di server.';
    console.error('[pinterest] error:', msg);
    return res.status(500).json({ success: false, error: msg });
  }
};
