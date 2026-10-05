/* ============================================================
   FORTECH FIRST TOOLS — API: YouTube Downloader
   Endpoint : POST /api/youtube
   Body     : { url, format }
   Provider : id.ytmp3.mobi (backend scrape)
   ============================================================ */

const MAX_POLLS = 50;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function extractVideoId(url) {
  if (!url) return null;
  let match = null;
  if (url.includes('youtube.com/shorts/') || url.includes('youtu.be/')) {
    match = /\/([a-zA-Z0-9\-_]{11})/.exec(url);
  } else if (url.includes('youtube.com')) {
    match = /v=([a-zA-Z0-9\-_]{11})/.exec(url);
  } else {
    match = /[a-zA-Z0-9\-_]{11}/.exec(url);
  }
  return match ? match[1] : null;
}

async function scrapeYtmp3(youtubeUrl, format) {
  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) throw new Error('URL YouTube tidak valid.');

  const lowerFormat = String(format || 'mp3').toLowerCase();
  if (lowerFormat !== 'mp3' && lowerFormat !== 'mp4') {
    throw new Error('Format harus "mp3" atau "mp4".');
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://id.ytmp3.mobi',
    'Referer': 'https://id.ytmp3.mobi/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site'
  };

  const initUrl = `https://a.ymcdn.org/api/v1/init?p=y&23=1llum1n471&_=${Math.random()}`;
  const initRes = await fetch(initUrl, { headers });
  if (!initRes.ok) throw new Error(`Init gagal (HTTP ${initRes.status}).`);
  const initJson = await initRes.json();
  if (initJson.error > 0) throw new Error(`Init error: ${initJson.error}`);

  let convertUrl = initJson.convertURL;
  let convertRequestUrl = `${convertUrl}&v=${videoId}&f=${lowerFormat}&_=${Math.random()}`;
  let convertJson;

  let redirectCount = 0;
  while (redirectCount < 3) {
    const convertRes = await fetch(convertRequestUrl, { headers });
    if (!convertRes.ok) throw new Error(`Convert gagal (HTTP ${convertRes.status}).`);
    convertJson = await convertRes.json();
    if (convertJson.error > 0) throw new Error(`Convert error: ${convertJson.error}`);

    if (convertJson.redirect > 0 && convertJson.redirectURL) {
      convertRequestUrl = `${convertJson.redirectURL}&v=${videoId}&f=${lowerFormat}&_=${Math.random()}`;
      redirectCount++;
      continue;
    }
    break;
  }

  const progressUrl = convertJson.progressURL;
  const downloadUrl = convertJson.downloadURL;
  let title = convertJson.title || '';

  if (!progressUrl) throw new Error('progressURL tidak ada di response.');

  let progress = 0;
  let pollCount = 0;

  while (progress < 3 && pollCount < MAX_POLLS) {
    await new Promise(r => setTimeout(r, 1000));
    pollCount++;

    const progressRes = await fetch(progressUrl, { headers });
    if (!progressRes.ok) throw new Error(`Progress gagal (HTTP ${progressRes.status}).`);
    const progressJson = await progressRes.json();
    if (progressJson.error > 0) throw new Error(`Progress error: ${progressJson.error}`);

    progress = progressJson.progress;
    if (progressJson.title) title = progressJson.title;
  }

  if (progress < 3) throw new Error('Konversi timeout (>50 detik).');

  return { videoId, title, format: lowerFormat, downloadUrl };
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const url = String(body.url || '').trim();
    const format = String(body.format || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '');

    if (!url) return res.status(400).json({ success: false, error: 'URL YouTube wajib diisi.' });

    const videoId = extractVideoId(url);
    if (!videoId) return res.status(400).json({ success: false, error: 'URL YouTube tidak valid.' });

    const fmt = format.includes('mp4') || format.includes('video') || format.includes('1080') || format.includes('720') || format.includes('480') ? 'mp4' : 'mp3';

    console.log(`[youtube] ${videoId} → ${fmt}`);
    const result = await scrapeYtmp3(url, fmt);
    console.log(`[youtube] sukses: ${result.title} (${fmt})`);

    return res.status(200).json({
      success: true,
      data: {
        videoId: result.videoId,
        title: result.title,
        format: result.format,
        download: result.downloadUrl,
        thumbnail: `https://i.ytimg.com/vi/${result.videoId}/hqdefault.jpg`
      }
    });
  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Terjadi kesalahan di server.';
    console.error('[youtube]', msg);
    return res.status(500).json({ success: false, error: msg });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '1mb' } }
};
