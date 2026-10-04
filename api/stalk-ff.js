/* ============================================================
   FORTECH FIRST TOOLS — API: Free Fire Stalker
   Endpoint : POST /api/stalk-ff
   Body     : { uid, region }
   Metode   : Multi-provider fallback
   ============================================================ */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

/* ---------- CORS ---------- */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

/* ---------- Normalisasi region ---------- */
function normalizeRegion(str) {
  const s = String(str || '').toUpperCase();
  if (s.includes('ID') || s.includes('INDONESIA')) return 'id';
  if (s.includes('MY') || s.includes('MALAYSIA')) return 'my';
  if (s.includes('SG') || s.includes('SINGAPORE')) return 'sg';
  if (s.includes('BR') || s.includes('BRAZIL')) return 'br';
  if (s.includes('IN') || s.includes('INDIA')) return 'ind';
  return 'id';
}

/* ============================================================
   PROVIDER 1 — freefirecommunity.com API
   ============================================================ */
async function providerFFC(uid, region) {
  const url = `https://freefirecommunity.com/api/ff-info?region=${region}&uid=${encodeURIComponent(uid)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json',
      'Referer': 'https://freefirecommunity.com/'
    }
  });
  if (!res.ok) throw new Error(`ffc HTTP ${res.status}`);
  const json = await res.json();
  const d = json.data || json;
  if (!d || (!d.nickname && !d.name)) throw new Error('ffc: data kosong');

  return {
    uid: String(d.uid || uid),
    nickname: d.nickname || d.name || '-',
    level: parseInt(d.level || d.account_level, 10) || 0,
    exp: parseInt(d.exp || d.experience, 10) || 0,
    rank: d.rank || d.br_rank || d.brRank || '-',
    rankPoints: parseInt(d.rank_points || d.br_points, 10) || 0,
    guild: d.guild || d.guild_name || null,
    region: region.toUpperCase(),
    avatar: d.avatar || d.profile_pic || null,
    signature: d.signature || d.bio || null,
    likes: parseInt(d.likes, 10) || 0,
    createdAt: d.created_at || null,
    lastLogin: d.last_login || null
  };
}

/* ============================================================
   PROVIDER 2 — ff.garena-api.workers.dev
   ============================================================ */
async function providerWorker(uid, region) {
  const url = `https://ff.garena-api.workers.dev/account?uid=${encodeURIComponent(uid)}&region=${region}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`worker HTTP ${res.status}`);
  const json = await res.json();
  if (json.success === false || !json.data) throw new Error('worker: data kosong');

  const d = json.data || json;
  const profile = d.profile || d;

  return {
    uid: String(profile.uid || profile.account_id || uid),
    nickname: profile.nickname || profile.name || '-',
    level: parseInt(profile.level || profile.account_level, 10) || 0,
    exp: parseInt(profile.exp, 10) || 0,
    rank: profile.rank || profile.br_rank || '-',
    rankPoints: parseInt(profile.rank_points || profile.br_points, 10) || 0,
    guild: profile.guild || profile.guild_name || null,
    region: region.toUpperCase(),
    avatar: profile.avatar || null,
    signature: profile.signature || null,
    likes: parseInt(profile.likes, 10) || 0,
    createdAt: profile.created_at || null,
    lastLogin: profile.last_login || null
  };
}

/* ============================================================
   PROVIDER 3 — garena-api.vercel.app (public demo)
   ============================================================ */
async function providerGarena(uid, region) {
  const url = `https://garena-api.vercel.app/api/ff?uid=${encodeURIComponent(uid)}&region=${region}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`garena HTTP ${res.status}`);
  const json = await res.json();
  const d = json.data || json;
  if (!d || (!d.nickname && !d.name)) throw new Error('garena: data kosong');

  return {
    uid: String(d.uid || uid),
    nickname: d.nickname || d.name || '-',
    level: parseInt(d.level, 10) || 0,
    exp: parseInt(d.exp, 10) || 0,
    rank: d.rank || '-',
    rankPoints: parseInt(d.rank_points, 10) || 0,
    guild: d.guild || null,
    region: region.toUpperCase(),
    avatar: d.avatar || null,
    signature: d.signature || null,
    likes: parseInt(d.likes, 10) || 0,
    createdAt: d.created_at || null,
    lastLogin: d.last_login || null
  };
}

/* ============================================================
   HANDLER
   ============================================================ */
module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Gunakan POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const uid = String(body.uid || '').trim().replace(/\D/g, '');
    const region = normalizeRegion(body.region);

    if (!uid) {
      return res.status(400).json({ success: false, error: 'UID Free Fire wajib diisi.' });
    }
    if (uid.length < 6 || uid.length > 14) {
      return res.status(400).json({ success: false, error: 'UID harus 6-14 digit angka.' });
    }

    /* Provider list — dicoba berurutan */
    const providers = [
      { name: 'freefirecommunity', fn: providerFFC },
      { name: 'worker', fn: providerWorker },
      { name: 'garena', fn: providerGarena }
    ];

    const errors = [];
    let result = null;
    let usedProvider = null;

    for (const p of providers) {
      try {
        console.log(`[stalk-ff] trying provider: ${p.name}`);
        const data = await p.fn(uid, region);
        if (data && data.nickname && data.nickname !== '-') {
          result = data;
          usedProvider = p.name;
          break;
        }
        errors.push(`${p.name}: data kosong`);
      } catch (e) {
        console.warn(`[stalk-ff] provider ${p.name} gagal:`, e.message);
        errors.push(`${p.name}: ${e.message}`);
      }
    }

    if (!result) {
      return res.status(404).json({
        success: false,
        error: `Player dengan UID ${uid} tidak ditemukan. Detail: ${errors.join(' | ')}`
      });
    }

    console.log(`[stalk-ff] sukses via provider: ${usedProvider}`);

    return res.status(200).json({
      success: true,
      data: {
        ...result,
        provider: usedProvider,
        profileUrl: `https://www.freefiremobile.com/`
      }
    });

  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Terjadi kesalahan di server.';
    console.error('[stalk-ff] error:', msg);
    return res.status(500).json({ success: false, error: msg });
  }
};
