/* ============================================================
   FORTECH FIRST TOOLS — API: TikTok Downloader
   Endpoint : POST /api/tiktok
   Body     : { url, option }
   Provider : tikwm.com (public API, no key)
   ============================================================ */

const TIKWM_API = 'https://www.tikwm.com/api/';

/* ---------- CORS ---------- */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

/* ---------- Validasi URL TikTok ---------- */
function isTikTokUrl(url) {
  return /^https?:\/\/(www\.|m\.|vm\.|vt\.)?tiktok\.com\//i.test(url) ||
         /^https?:\/\/(www\.)?douyin\.com\//i.test(url);
}

/* ---------- Parse option ---------- */
function parseOption(str) {
  const s = String(str || '').toLowerCase();
  if (s.includes('wm') || s.includes('watermark') && !s.includes('tanpa')) {
    if (s.includes('dengan')) return 'watermark';
  }
  if (s.includes('dengan watermark')) return 'watermark';
  if (s.includes('audio') || s.includes('mp3')) return 'audio';
  if (s.includes('sd')) return 'sd';
  return 'hd'; // default: no watermark HD
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
    const { url, option } = body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'URL TikTok wajib diisi.' });
    }
    const cleanUrl = url.trim();
    if (!isTikTokUrl(cleanUrl)) {
      return res.status(400).json({ success: false, error: 'URL TikTok tidak valid.' });
    }

    const mode = parseOption(option);

    /* Request ke tikwm.com */
    const apiUrl = `${TIKWM_API}?url=${encodeURIComponent(cleanUrl)}&hd=1`;
    const apiRes = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (!apiRes.ok) {
      throw new Error(`Provider HTTP ${apiRes.status}`);
    }

    const json = await apiRes.json();

    /* tikwm format: { code: 0, msg: "success", data: {...} } */
    if (json.code !== 0 || !json.data) {
      return res.status(500).json({
        success: false,
        error: json.msg || 'Gagal mengambil data TikTok. Pastikan link valid.'
      });
    }

    const d = json.data;
    const author = d.author || {};

    /* Pilih video berdasarkan mode */
    let videoUrl = null;
    let videoLabel = '';
    if (mode === 'watermark') {
      videoUrl = d.wmplay || d.play;
      videoLabel = 'Dengan Watermark';
    } else if (mode === 'sd') {
      videoUrl = d.play;
      videoLabel = 'Tanpa Watermark · SD';
    } else if (mode === 'audio') {
      videoUrl = null;
      videoLabel = 'Audio MP3';
    } else {
      videoUrl = d.hdplay || d.play;
      videoLabel = 'Tanpa Watermark · HD';
    }

    /* Normalisasi URL yang dikasih tikwm (kadang relative) */
    function normalizeUrl(u) {
      if (!u) return null;
      if (u.startsWith('http')) return u;
      return 'https://www.tikwm.com' + u;
    }

    return res.status(200).json({
      success: true,
      data: {
        id: d.id || '',
        title: d.title || 'TikTok Video',
        cover: normalizeUrl(d.cover || d.origin_cover),
        author: author.nickname || author.unique_id || d.author?.nickname || '-',
        username: author.unique_id || '',
        avatar: normalizeUrl(author.avatar),
        duration: d.duration ? d.duration + ' detik' : null,
        plays: d.play_count || null,
        likes: d.digg_count || null,
        comments: d.comment_count || null,
        shares: d.share_count || null,
        video: mode === 'audio' ? null : normalizeUrl(videoUrl),
        videoLabel,
        audio: normalizeUrl(d.music),
        option: mode
      }
    });

  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Terjadi kesalahan di server.';
    console.error('[tiktok] error:', msg, err && err.stack);
    return res.status(500).json({ success: false, error: msg });
  }
};
