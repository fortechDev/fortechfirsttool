/* ============================================================
   FORTECH FIRST TOOLS — API: TikTok Stalker
   Endpoint : POST /api/stalk-tiktok
   Body     : { username }
   Metode   : SSR scraping dari halaman publik TikTok
   ============================================================ */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function cleanUsername(str) {
  return String(str || '')
    .trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, '')
    .replace(/\/.*$/, '')
    .replace(/[^A-Za-z0-9._]/g, '')
    .slice(0, 24);
}

/* ---------- Fetch halaman profil ---------- */
async function fetchProfileHTML(username, attempt = 1) {
  const url = `https://www.tiktok.com/@${encodeURIComponent(username)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'no-cache'
    },
    redirect: 'follow'
  });

  // Retry kalau 403/429
  if ((res.status === 403 || res.status === 429) && attempt < 3) {
    await new Promise(r => setTimeout(r, 800 * attempt));
    return fetchProfileHTML(username, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`TikTok HTTP ${res.status} saat ambil profil @${username}`);
  }
  return await res.text();
}

/* ---------- Ekstrak JSON dari script tag ---------- */
function extractUniversalData(html) {
  const marker = 'id="__UNIVERSAL_DATA_FOR_REHYDRATION__"';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('Data profil tidak ditemukan di halaman TikTok.');

  const gt = html.indexOf('>', start);
  if (gt < 0) throw new Error('Malformed script tag.');

  const jsonStart = gt + 1;
  const end = html.indexOf('</script>', jsonStart);
  if (end < 0) throw new Error('Script tag tidak tertutup.');

  const raw = html.slice(jsonStart, end).trim();
  if (!raw.startsWith('{')) throw new Error('Script tag tidak berisi JSON.');

  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('Gagal parse JSON TikTok: ' + e.message);
  }
}

/* ---------- Ambil user detail dari JSON ---------- */
function parseUserDetail(json) {
  const scope = json && json.__DEFAULT_SCOPE__;
  if (!scope) throw new Error('Struktur JSON TikTok tidak dikenali.');

  const detail = scope['webapp.user-detail'];
  if (!detail) throw new Error('Data user-detail tidak ada di response.');

  const status = detail.statusCode;
  if (status && status !== 0) {
    throw new Error(detail.statusMsg || 'Profil tidak bisa diakses.');
  }

  const info = detail.userInfo;
  if (!info || !info.user) throw new Error('User tidak ditemukan atau akun private.');

  return {
    user: info.user,
    stats: info.stats || {},
    statsV2: info.statsV2 || null
  };
}

/* ---------- Helper angka ---------- */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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
    const username = cleanUsername(body.username);

    if (!username) {
      return res.status(400).json({ success: false, error: 'Username TikTok wajib diisi.' });
    }
    if (username.length < 2) {
      return res.status(400).json({ success: false, error: 'Username terlalu pendek.' });
    }

    const html = await fetchProfileHTML(username);
    const json = extractUniversalData(html);
    const { user, stats, statsV2 } = parseUserDetail(json);

    /* Prioritas: statsV2 (angka exact) → fallback stats */
    let follower = null, following = null, likes = null, videos = null;

    if (statsV2 && typeof statsV2 === 'object') {
      follower = num(statsV2.followerCount);
      following = num(statsV2.followingCount);
      likes = num(statsV2.heartCount || statsV2.heart);
      videos = num(statsV2.videoCount);
    }
    if (follower == null || follower === 0) follower = num(stats.followerCount);
    if (following == null || following === 0) following = num(stats.followingCount);
    if (likes == null || likes === 0) likes = num(stats.heartCount || stats.heart);
    if (videos == null || videos === 0) videos = num(stats.videoCount);

    return res.status(200).json({
      success: true,
      data: {
        id: user.id || '',
        username: user.uniqueId || username,
        nickname: user.nickname || '-',
        avatar: user.avatarLarger || user.avatarMedium || user.avatarThumb || null,
        bio: user.signature || '',
        verified: !!user.verified,
        privateAccount: !!user.privateAccount,
        region: user.region || null,
        language: user.language || null,
        followers: follower,
        following: following,
        likes: likes,
        videos: videos,
        friends: num(stats.friendCount),
        digg: num(stats.diggCount),
        secUid: user.secUid || '',
        profileUrl: `https://www.tiktok.com/@${user.uniqueId || username}`
      }
    });

  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Terjadi kesalahan di server.';
    console.error('[stalk-tiktok] error:', msg);
    return res.status(500).json({ success: false, error: msg });
  }
};
