/* ============================================================
   FORTECH FIRST TOOLS — API: YouTube Downloader
   Endpoint: POST /api/youtube
   Body    : { url, format, type }
   Runtime : Node.js 20.x (CommonJS)
   ============================================================ */

const ytdl = require('@distube/ytdl-core');

/* ---------- Config ---------- */
const AGENT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

/* ---------- Helpers ---------- */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function parseFormat(str) {
  const s = String(str || '').toLowerCase();
  const container = s.includes('mp3') ? 'mp3' : 'mp4';
  const q = s.match(/(\d{3,4})p/);
  const quality = q ? parseInt(q[1], 10) : 720;
  return { container, quality };
}

function pickFormat(formats, container, quality, type) {
  const t = String(type || '').toLowerCase();
  const audioOnly = t.includes('audio') || container === 'mp3';
  const videoOnly = t.includes('video only');

  let candidates = formats.filter(f => {
    if (audioOnly) return f.hasAudio && !f.hasVideo;
    if (videoOnly) return f.hasVideo && !f.hasAudio;
    return f.hasVideo && f.hasAudio;
  });

  if (!candidates.length && !audioOnly && !videoOnly) {
    candidates = formats.filter(f => f.hasVideo);
  }

  if (!candidates.length) {
    if (audioOnly) candidates = formats.filter(f => f.hasAudio);
    if (!candidates.length) candidates = formats.filter(f => f.hasVideo || f.hasAudio);
  }

  if (!candidates.length) return null;

  if (audioOnly) {
    return candidates.slice().sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
  }

  const withHeight = candidates.filter(f => f.height);
  if (withHeight.length) {
    return withHeight
      .slice()
      .sort((a, b) => Math.abs(a.height - quality) - Math.abs(b.height - quality))[0];
  }

  return candidates.slice().sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
}

function fmtDuration(sec) {
  const s = parseInt(sec, 10) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

/* ---------- Handler ---------- */
module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Gunakan POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { url, format, type } = body;

    /* Validasi */
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'URL YouTube wajib diisi.' });
    }
    const cleanUrl = url.trim();

    if (!ytdl.validateURL(cleanUrl)) {
      return res.status(400).json({ success: false, error: 'URL YouTube tidak valid.' });
    }

    /* Ambil info */
    const info = await ytdl.getInfo(cleanUrl, {
      requestOptions: { headers: AGENT_HEADERS }
    });

    const details = info.videoDetails || {};
    const { container, quality } = parseFormat(format);

    /* Pilih format */
    const chosen = pickFormat(info.formats, container, quality, type);
    if (!chosen || !chosen.url) {
      return res.status(500).json({
        success: false,
        error: 'Tidak ada format yang cocok. Coba pilih format lain.'
      });
    }

    /* Thumbnail terbesar */
    const thumbs = (details.thumbnails || []).slice();
    thumbs.sort((a, b) => (b.width || 0) - (a.width || 0));
    const thumb = thumbs[0] || {};

    /* Response */
    return res.status(200).json({
      success: true,
      data: {
        title: details.title || '-',
        author: (details.author && details.author.name) || '-',
        duration: fmtDuration(details.lengthSeconds),
        durationSeconds: parseInt(details.lengthSeconds, 10) || 0,
        thumbnail: thumb.url || '',
        videoId: details.videoId || '',
        container: chosen.container || container,
        quality: chosen.qualityLabel || (chosen.height ? chosen.height + 'p' : 'audio'),
        size: chosen.contentLength
          ? (parseInt(chosen.contentLength, 10) / 1024 / 1024).toFixed(1) + ' MB'
          : null,
        download: chosen.url,
        note: 'Link berlaku sementara. Kalau expired, cari ulang.'
      }
    });

  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Gagal mengambil data dari YouTube.';
    console.error('[youtube] error:', msg);

    let friendly = msg;
    if (/sign in to confirm|bot/i.test(msg)) {
      friendly = 'YouTube memblokir request dari server ini. Coba lagi nanti atau gunakan link lain.';
    } else if (/private|unavailable/i.test(msg)) {
      friendly = 'Video tidak tersedia atau bersifat private.';
    } else if (/age/i.test(msg)) {
      friendly = 'Video dibatasi umur dan tidak bisa diakses tanpa login.';
    }

    return res.status(500).json({ success: false, error: friendly });
  }
};
