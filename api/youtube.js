/* ============================================================
   FORTECH FIRST TOOLS — API: YouTube Downloader
   Endpoint : POST /api/youtube
   Body     : { url, format, type }
   Library  : yt-direct (InnerTube API, zero-dependency)
   ============================================================ */

const ytdl = require('yt-direct');

/* ---------- CORS ---------- */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

/* ---------- Parse "MP4 · 1080p" ---------- */
function parseFormat(str) {
  const s = String(str || '').toLowerCase();
  const container = s.includes('mp3') || s.includes('audio') ? 'audio' : 'mp4';
  const q = s.match(/(\d{3,4})p/);
  const quality = q ? q[1] + 'p' : '720p';
  return { container, quality };
}

/* ---------- Format durasi ---------- */
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

    /* Validasi input */
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'URL YouTube wajib diisi.' });
    }
    const cleanUrl = url.trim();

    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(cleanUrl)) {
      return res.status(400).json({ success: false, error: 'URL YouTube tidak valid.' });
    }

    /* Parse format dari UI */
    const { container, quality } = parseFormat(format);
    const isAudio = container === 'audio' || String(type || '').toLowerCase().includes('audio');

    /* Fetch info + format via yt-direct (InnerTube API) */
    const video = await ytdl(cleanUrl, {
      quality: isAudio ? 'audio' : quality,
      format: isAudio ? 'mp3' : 'mp4',
      filter: isAudio ? 'audioonly' : 'audioandvideo',
      preferMp4: true,
      timeout: 25000,
      retries: 2
    });

    if (!video || !video.url) {
      return res.status(500).json({
        success: false,
        error: 'Tidak ada format yang cocok. Coba pilih format lain.'
      });
    }

    /* Response */
    return res.status(200).json({
      success: true,
      data: {
        title: video.title || '-',
        author: video.author || '-',
        duration: video.duration ? fmtDuration(video.duration) : '-',
        durationSeconds: parseInt(video.duration, 10) || 0,
        thumbnail: video.thumbnail || (video.videoId ? `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg` : ''),
        videoId: video.videoId || '',
        container: video.format && video.format.container ? video.format.container : (isAudio ? 'mp3' : 'mp4'),
        quality: video.quality || (isAudio ? 'audio' : 'video'),
        size: video.size ? (video.size / 1024 / 1024).toFixed(1) + ' MB' : null,
        download: video.url,
        audioDownload: video.audio && video.audio.url ? video.audio.url : null,
        note: 'Link berlaku sementara. Kalau expired, cari ulang.'
      }
    });

  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Gagal mengambil data dari YouTube.';
    console.error('[youtube] error:', msg);

    let friendly = msg;
    if (/sign in to confirm|bot/i.test(msg)) {
      friendly = 'YouTube masih memblokir request. Coba lagi beberapa saat.';
    } else if (/private|unavailable/i.test(msg)) {
      friendly = 'Video tidak tersedia atau bersifat private.';
    } else if (/age/i.test(msg)) {
      friendly = 'Video dibatasi umur dan tidak bisa diakses tanpa login.';
    } else if (/timeout/i.test(msg)) {
      friendly = 'Request timeout. Coba lagi.';
    }

    return res.status(500).json({ success: false, error: friendly });
  }
};
