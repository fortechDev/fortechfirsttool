/* ============================================================
   FORTECH FIRST TOOLS — API: TikTok Stalker
   Endpoint : POST /api/stalk-tiktok
   Body     : { username }
   Provider : tikwm.com (public API, no key)
   ============================================================ */

const TIKWM_USER_API = 'https://www.tikwm.com/api/user/info';

/* ---------- CORS ---------- */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

/* ---------- Bersihin username ---------- */
function cleanUsername(str) {
  return String(str || '')
    .trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, '')
    .replace(/\/.*$/, '')
    .replace(/[^A-Za-z0-9._]/g, '')
    .slice(0, 24);
}

/* ---------- Normalisasi URL relatif dari tikwm ---------- */
function normalizeUrl(u) {
  if (!u) return null;
  if (u.startsWith('http')) return u;
  return 'https://www.tikwm.com' + u;
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

    /* Request ke tikwm */
    const apiUrl = `${TIKWM_USER_API}?unique_id=${encodeURIComponent(username)}`;
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

    /* tikwm format */
    if (json.code !== 0 || !json.data) {
      return res.status(404).json({
        success: false,
        error: json.msg || `User @${username} tidak ditemukan.`
      });
    }

    const d = json.data;
    const user = d.user || {};
    const stats = d.stats || {};

    /* Format angka */
    function num(n) {
      return Number(n) || 0;
    }

    return res.status(200).json({
      success: true,
      data: {
        id: user.id || '',
        username: user.uniqueId || username,
        nickname: user.nickname || '-',
        avatar: normalizeUrl(user.avatarLarger || user.avatarMedium || user.avatarThumb),
        bio: user.signature || '',
        verified: !!user.verified,
        privateAccount: !!user.privateAccount,
        region: user.region || null,
        language: user.language || null,
        followers: num(stats.followerCount),
        following: num(stats.followingCount),
        likes: num(stats.heartCount || stats.heart),
        videos: num(stats.videoCount),
        friends: num(stats.friendCount),
        digg: num(stats.diggCount),
        profileUrl: `https://www.tiktok.com/@${user.uniqueId || username}`
      }
    });

  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Terjadi kesalahan di server.';
    console.error('[stalk-tiktok] error:', msg, err && err.stack);
    return res.status(500).json({ success: false, error: msg });
  }
};
