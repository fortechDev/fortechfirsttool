/* ============================================================
   FORTECH FIRST TOOLS — API: YouTube Downloader
   Endpoint : POST /api/youtube
   Body     : { url, format, type }
   Library  : youtubei.js (InnerTube API — sama seperti yt-dlp)
   ============================================================ */

const { Innertube, UniversalCache } = require('youtubei.js');

/* ---------- Singleton client (cache antar-request) ---------- */
let _client = null;
async function getClient() {
  if (!_client) {
    _client = await Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true,
      retrieve_player: true
    });
  }
  return _client;
}

/* ---------- CORS ---------- */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

/* ---------- Extract video ID ---------- */
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/,
    /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/live\/)([A-Za-z0-9_-]{11})/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/* ---------- Parse "MP4 · 1080p" ---------- */
function parseFormat(str) {
  const s = String(str || '').toLowerCase();
  const isAudio = s.includes('mp3') || s.includes('audio');
  const q = s.match(/(\d{3,4})p/);
  const quality = q ? q[1] + 'p' : '720p';
  return { isAudio, quality };
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

/* ---------- Pilih format ---------- */
function pickFormat(info, isAudio, quality, videoOnly) {
  try {
    if (isAudio) {
      return info.chooseFormat({ type: 'audio', quality: 'best' });
    }
    if (videoOnly) {
      return info.chooseFormat({ type: 'video', quality }) ||
             info.chooseFormat({ type: 'video', quality: 'best' });
    }
    /* Combined video+audio — biasanya max 720p */
    const combined = info.chooseFormat({ type: 'video+audio', quality }) ||
                     info.chooseFormat({ type: 'video+audio', quality: 'best' });
    if (combined) return combined;
    /* Fallback: video-only */
    return info.chooseFormat({ type: 'video', quality: 'best' });
  } catch (e) {
    return null;
  }
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
    const { url, format, type } = body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'URL YouTube wajib diisi.' });
    }
    const cleanUrl = url.trim();
    const videoId = extractVideoId(cleanUrl);
    if (!videoId) {
      return res.status(400).json({ success: false, error: 'URL YouTube tidak valid.' });
    }

    const { isAudio, quality } = parseFormat(format);
    const videoOnly = String(type || '').toLowerCase().includes('video only');

    /* Ambil client & info */
    const yt = await getClient();
    const info = await yt.getInfo(videoId);

    const basic = info.basic_info || {};
    const title = basic.title || '-';
    const author = basic.author || '-';
    const durationSec = basic.duration || 0;
    const thumbnails = basic.thumbnail || [];
    const thumbnail = thumbnails.length
      ? thumbnails[thumbnails.length - 1].url
      : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    /* Pilih format */
    const chosen = pickFormat(info, isAudio, quality, videoOnly);
    if (!chosen) {
      return res.status(500).json({
        success: false,
        error: 'Tidak ada format yang cocok. Coba pilih format lain.'
      });
    }

    /* Decipher URL */
    let downloadUrl;
    try {
      downloadUrl = chosen.decipher(yt.session.player);
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: 'Gagal decipher URL download. Coba lagi.'
      });
    }

    if (!downloadUrl) {
      return res.status(500).json({
        success: false,
        error: 'URL download kosong. Coba lagi.'
      });
    }

    /* Response */
    return res.status(200).json({
      success: true,
      data: {
        title,
        author,
        duration: fmtDuration(durationSec),
        durationSeconds: durationSec,
        thumbnail,
        videoId,
        container: chosen.container || (isAudio ? 'mp3' : 'mp4'),
        quality: chosen.quality_label || chosen.quality || (isAudio ? 'audio' : quality),
        size: chosen.content_length
          ? (parseInt(chosen.content_length, 10) / 1024 / 1024).toFixed(1) + ' MB'
          : null,
        download: downloadUrl,
        note: 'Link berlaku sementara (beberapa jam). Kalau expired, cari ulang.'
      }
    });

  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Gagal mengambil data dari YouTube.';
    console.error('[youtube] error:', msg, err && err.stack);

    let friendly = msg;
    if (/sign in to confirm|bot/i.test(msg)) {
      friendly = 'YouTube memblokir request dari server ini. Coba lagi beberapa saat.';
    } else if (/private|unavailable|not available/i.test(msg)) {
      friendly = 'Video tidak tersedia atau bersifat private.';
    } else if (/age/i.test(msg)) {
      friendly = 'Video dibatasi umur dan tidak bisa diakses tanpa login.';
    } else if (/timeout|ETIMEDOUT/i.test(msg)) {
      friendly = 'Request timeout. Coba lagi.';
    } else if (/parse|decipher|signature/i.test(msg)) {
      friendly = 'Gagal memproses signature video. Coba lagi beberapa saat.';
    }

    return res.status(500).json({ success: false, error: friendly });
  }
};
