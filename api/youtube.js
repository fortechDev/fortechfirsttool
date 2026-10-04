/* ============================================================
   FORTECH FIRST TOOLS — API: YouTube Downloader
   Client: ANDROID + fallback TV_EMBEDDED untuk age-gate
   ============================================================ */

const INNERTUBE_KEY = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';

/* Client configs */
const CLIENTS = {
  android: {
    clientName: 'ANDROID',
    clientNameId: '3',
    clientVersion: '20.10.38',
    androidSdkVersion: 30,
    userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip'
  },
  tv: {
    clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    clientNameId: '85',
    clientVersion: '2.0',
    userAgent: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version'
  }
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

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

function parseFormat(str) {
  const s = String(str || '').toLowerCase();
  const isAudio = s.includes('mp3') || s.includes('audio');
  const m = s.match(/(\d{3,4})p/);
  const quality = m ? parseInt(m[1], 10) : 720;
  return { isAudio, quality };
}

function fmtDuration(sec) {
  const s = parseInt(sec, 10) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

async function fetchPlayerWithClient(videoId, clientKey, cookie) {
  const c = CLIENTS[clientKey];
  if (!c) throw new Error('Unknown client: ' + clientKey);

  const url = `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`;

  const payload = {
    context: {
      client: {
        clientName: c.clientName,
        clientVersion: c.clientVersion,
        hl: 'en',
        timeZone: 'UTC',
        utcOffsetMinutes: 0
      }
    },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true
  };

  if (c.androidSdkVersion) {
    payload.context.client.androidSdkVersion = c.androidSdkVersion;
  }

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': c.userAgent,
    'X-Goog-Api-Format-Version': '2',
    'X-YouTube-Client-Name': c.clientNameId,
    'X-YouTube-Client-Version': c.clientVersion
  };

  if (cookie) headers['Cookie'] = cookie;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`InnerTube HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }
  return await res.json();
}

function pickStream(playerData, isAudio, targetQuality, videoOnly) {
  const sd = playerData.streamingData || {};
  const all = [];

  if (Array.isArray(sd.formats)) {
    for (const f of sd.formats) all.push({ ...f, hasVideo: true, hasAudio: true });
  }
  if (Array.isArray(sd.adaptiveFormats)) {
    for (const f of sd.adaptiveFormats) {
      const mime = f.mimeType || '';
      all.push({
        ...f,
        hasVideo: mime.startsWith('video/'),
        hasAudio: mime.startsWith('audio/')
      });
    }
  }

  if (!all.length) return null;

  let candidates;
  if (isAudio) {
    candidates = all.filter(f => f.hasAudio && !f.hasVideo);
  } else if (videoOnly) {
    candidates = all.filter(f => f.hasVideo && !f.hasAudio);
  } else {
    candidates = all.filter(f => f.hasVideo && f.hasAudio);
    if (!candidates.length) candidates = all.filter(f => f.hasVideo);
  }
  if (!candidates.length) return null;

  if (isAudio) {
    return candidates.slice().sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
  }

  const withHeight = candidates.filter(f => f.height);
  if (withHeight.length) {
    return withHeight.slice().sort(
      (a, b) => Math.abs((a.height || 0) - targetQuality) - Math.abs((b.height || 0) - targetQuality)
    )[0];
  }
  return candidates.slice().sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
}

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
    const videoId = extractVideoId(url.trim());
    if (!videoId) {
      return res.status(400).json({ success: false, error: 'URL YouTube tidak valid.' });
    }

    const { isAudio, quality } = parseFormat(format);
    const videoOnly = String(type || '').toLowerCase().includes('video only');

    /* Cookie optional dari env var */
    const cookie = process.env.YOUTUBE_COOKIE || null;

    /* Coba client ANDROID dulu, kalau LOGIN_REQUIRED fallback ke TV */
    let playerData = null;
    let usedClient = 'android';

    try {
      playerData = await fetchPlayerWithClient(videoId, 'android', cookie);
      const st = (playerData.playabilityStatus || {}).status;
      if (st && st !== 'OK' && /LOGIN_REQUIRED|AGE|CONTENT_CHECK/i.test(st)) {
        console.log('[youtube] Android blocked, fallback ke TV_EMBEDDED...');
        playerData = null;
      }
    } catch (e) {
      console.error('[youtube] Android client error:', e.message);
    }

    if (!playerData) {
      usedClient = 'tv';
      playerData = await fetchPlayerWithClient(videoId, 'tv', cookie);
    }

    const status = playerData.playabilityStatus || {};
    if (status.status !== 'OK') {
      const map = {
        LOGIN_REQUIRED: 'Video memerlukan login (kemungkinan age-restricted). Solusi: tambah cookie YouTube di env var Vercel.',
        UNPLAYABLE: 'Video tidak bisa diputar.',
        ERROR: 'Video tidak ditemukan atau tidak tersedia.',
        CONTENT_CHECK_REQUIRED: 'Video butuh verifikasi konten.'
      };
      return res.status(500).json({
        success: false,
        error: map[status.status] || ('Video tidak tersedia: ' + (status.reason || status.status))
      });
    }

    const details = playerData.videoDetails || {};
    const stream = pickStream(playerData, isAudio, quality, videoOnly);

    if (!stream) {
      return res.status(500).json({ success: false, error: 'Tidak ada format yang tersedia untuk permintaan ini.' });
    }
    if (!stream.url) {
      return res.status(500).json({ success: false, error: 'URL download tidak tersedia. Coba format lain.' });
    }

    const thumbs = (details.thumbnail && details.thumbnail.thumbnails) || [];
    const thumbnail = thumbs.length ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    const mime = stream.mimeType || '';

    return res.status(200).json({
      success: true,
      data: {
        title: details.title || '-',
        author: details.author || '-',
        duration: fmtDuration(details.lengthSeconds),
        durationSeconds: parseInt(details.lengthSeconds, 10) || 0,
        thumbnail,
        videoId,
        client: usedClient,
        container: mime.includes('mp4') ? 'mp4' : mime.includes('webm') ? 'webm' : (isAudio ? 'audio' : 'mp4'),
        quality: stream.qualityLabel || stream.quality || (isAudio ? 'audio' : 'video'),
        size: stream.contentLength ? (parseInt(stream.contentLength, 10) / 1024 / 1024).toFixed(1) + ' MB' : null,
        download: stream.url,
        note: 'Link berlaku sementara (beberapa jam). Kalau expired, cari ulang.'
      }
    });

  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Terjadi kesalahan di server.';
    console.error('[youtube] error:', msg, err && err.stack);
    return res.status(500).json({ success: false, error: msg });
  }
};
