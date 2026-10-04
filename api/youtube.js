/* ============================================================
   FORTECH FIRST TOOLS — API: YouTube Downloader
   Endpoint: POST /api/youtube
   Body    : { url, format, type }
   ============================================================ */

const ytdl = require('@distube/ytdl-core');

/* ---------- CORS ---------- */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* ---------- Parse "MP4 · 1080p" → { container, quality } ---------- */
function parseFormat(str) {
  const s = String(str || '').toLowerCase();
  const container = s.includes('mp3') ? 'mp3' : 'mp4';
  const q = s.match(/(\d{3,4})p/);
  const quality = q ? q[1] : '720';
  return { container, quality };
}

/* ---------- Pilih format terbaik dari daftar ---------- */
function pickFormat(formats, container, quality, type) {
  const t = String(type || '').toLowerCase();
  const audioOnly = t.includes('audio') || container === 'mp3';
  const videoOnly = t.includes('video only');

  // Filter kandidat
  let candidates = formats.filter(f => {
    if (audioOnly) return f.hasAudio && !f.hasVideo;
    if (videoOnly) return f.hasVideo && !f.hasAudio;
    return f.hasVideo && f.hasAudio; // default: butuh video + audio
  });

  // Fallback: kalau video+audio nggak ada, pakai video-only
  if (!candidates.length && !audioOnly) {
    candidates = formats.filter(f => f.hasVideo);
  }

  if (!candidates.length) return null;

  if (audioOnly) {
    // Ambil audio bitrate tertinggi
    return candidates.sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
  }

  // Cari yang paling dekat dengan quality yang diminta
  const target = parseInt(quality, 10);
  const withHeight = candidates.filter(f => f.height);

  if (withHeight.length) {
    return withHeight
      .sort((a, b) => Math.abs(a.height - target) - Math.abs(b.height - target))[0];
  }

  // Kalau nggak ada info height, ambil bitrate tertinggi
  return candidates.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
}

/* ---------- Format durasi ---------- */
function fmtDuration(sec) {
  const s = parseInt(sec, 10) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

/* ---------- Handler utama ---------- */
module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { url, format, type } = req.body || {};

    /* Validasi URL */
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'URL YouTube wajib diisi.' });
    }
    if (!ytdl.validateURL(url.trim())) {
      return res.status(400).json({ success: false, error: 'URL YouTube tidak valid.' });
    }

    /* Ambil info video */
    const info = await ytdl.getInfo(url.trim(), {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      }
    });

    const details = info.videoDetails;
    const { container, quality } = parseFormat(format);

    /* Pilih format */
    const chosen = pickFormat(info.formats, container, quality, type);
    if (!chosen) {
      return res.status(500).json({ success: false, error: 'Tidak ada format yang cocok untuk permintaan ini.' });
    }

    /* Ambil thumbnail terbesar */
    const thumb = (details.thumbnails || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0];

    /* Response */
    return res.status(200).json({
      success: true,
      data: {
        title: details.title,
        author: details.author?.name || '-',
        duration: fmtDuration(details.lengthSeconds),
        durationSeconds: parseInt(details.lengthSeconds, 10) || 0,
        thumbnail: thumb?.url || '',
        videoId: details.videoId,
        container: chosen.container || container,
        quality: chosen.qualityLabel || (chosen.height ? chosen.height + 'p' : 'audio'),
        size: chosen.contentLength
          ? (parseInt(chosen.contentLength, 10) / 1024 / 1024).toFixed(1) + ' MB'
          : null,
        download: chosen.url,
        note: 'Link download berlaku sementara (beberapa jam). Kalau expired, cari ulang.'
      }
    });

  } catch (err) {
    console.error('[youtube] error:', err?.message || err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Gagal mengambil data dari YouTube. Coba lagi nanti.'
    });
  }
};
