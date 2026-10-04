/* ============================================================
   FORTECH FIRST TOOLS — API: Free Fire Stalker
   Endpoint : POST /api/stalk-ff
   Body     : { uid, region }
   Providers: PRINCE-LKTEAM (Render) + jinix6/0xMe (Render)
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
  if (s.includes('ID') || s.includes('INDONESIA')) return 'ID';
  if (s.includes('MY') || s.includes('MALAYSIA')) return 'MY';
  if (s.includes('SG') || s.includes('SINGAPORE')) return 'SG';
  if (s.includes('BR') || s.includes('BRAZIL')) return 'BR';
  if (s.includes('IN') || s.includes('INDIA')) return 'IND';
  if (s.includes('TH') || s.includes('THAILAND')) return 'TH';
  if (s.includes('VN') || s.includes('VIETNAM')) return 'VN';
  if (s.includes('PH') || s.includes('PHILIPPINES')) return 'PH';
  if (s.includes('PK') || s.includes('PAKISTAN')) return 'PK';
  if (s.includes('BD') || s.includes('BANGLADESH')) return 'BD';
  if (s.includes('ME') || s.includes('MIDDLE')) return 'ME';
  if (s.includes('CIS')) return 'CIS';
  if (s.includes('RU') || s.includes('RUSSIA')) return 'RU';
  if (s.includes('TW') || s.includes('TAIWAN')) return 'TW';
  if (s.includes('US') || s.includes('UNITED')) return 'US';
  return 'ID';
}

/* ---------- Fetch dengan timeout ---------- */
async function fetchWithTimeout(url, ms = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: ctrl.signal
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

/* ---------- Helper angka ---------- */
function num(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

/* ============================================================
   PROVIDER 1 — PRINCE-LKTEAM Free Fire API (Render)
   Base: https://freefireinfo-zy9l.onrender.com
   Endpoint: /api/v1/player-profile?uid={uid}&server={region}
   ============================================================ */
async function providerPrince(uid, region) {
  const url = `https://freefireinfo-zy9l.onrender.com/api/v1/player-profile?uid=${encodeURIComponent(uid)}&server=${encodeURIComponent(region)}`;
  const res = await fetchWithTimeout(url, 22000);
  if (!res.ok) throw new Error(`prince HTTP ${res.status}`);

  const json = await res.json();
  if (json.status === 'error' || json.code === 404) {
    throw new Error(json.message || 'Player tidak ditemukan.');
  }

  const d = json.data || json;
  const basic = d.basicInfo || d.basic_info || d.accountInfo || d;
  const profile = d.profileInfo || d.profile_info || {};
  const social = d.socialInfo || d.social_info || {};
  const guild = d.guildInfo || d.clanBasicInfo || d.clan_basic_info || {};

  if (!basic.nickname && !basic.accountid && !basic.accountId) {
    throw new Error('prince: data tidak lengkap');
  }

  return {
    uid: String(basic.accountid || basic.accountId || uid),
    nickname: basic.nickname || '-',
    level: num(basic.level),
    exp: num(basic.exp),
    rank: basic.rank || 0,
    rankPoints: num(basic.rankingpoints || basic.rankingPoints),
    csRank: basic.csrank || basic.csRank || 0,
    csRankPoints: num(basic.csrankingpoints || basic.csRankingPoints),
    maxRank: basic.maxrank || basic.maxRank || 0,
    guild: guild.guildName || guild.clanName || guild.guild_name || null,
    guildId: guild.guildId || guild.clanId || null,
    guildLevel: guild.guildLevel || guild.clanLevel || null,
    region: (basic.region || region).toUpperCase(),
    signature: social.signature || null,
    likes: num(basic.liked || basic.like),
    title: basic.title || null,
    avatarId: basic.headpic || basic.headPic || null,
    bannerId: basic.bannerid || basic.bannerId || null,
    seasonId: basic.seasonid || basic.seasonId || null,
    createdAt: basic.createat || basic.createAt || null,
    lastLogin: basic.lastloginat || basic.lastLoginAt || null,
    provider: 'prince',
    raw: null
  };
}

/* ============================================================
   PROVIDER 2 — jinix6/0xMe FreeFire-Api (Render)
   Base: https://free-ff-api-src-5plp.onrender.com
   Endpoint: /api/v1/account?region={region}&uid={uid}
   ============================================================ */
async function providerJinix(uid, region) {
  const url = `https://free-ff-api-src-5plp.onrender.com/api/v1/account?region=${encodeURIComponent(region)}&uid=${encodeURIComponent(uid)}`;
  const res = await fetchWithTimeout(url, 22000);
  if (!res.ok) throw new Error(`jinix HTTP ${res.status}`);

  const json = await res.json();
  if (json.error || json.status === 'error') {
    throw new Error(json.error || json.message || 'Player tidak ditemukan.');
  }

  const basic = json.basicInfo || json.basic_info || json;
  const social = json.socialInfo || json.social_info || {};
  const clan = json.clanBasicInfo || json.clan_basic_info || json.guildInfo || {};

  if (!basic.nickname && !basic.accountId && !basic.accountid) {
    throw new Error('jinix: data tidak lengkap');
  }

  return {
    uid: String(basic.accountId || basic.accountid || uid),
    nickname: basic.nickname || '-',
    level: num(basic.level),
    exp: num(basic.exp),
    rank: basic.rank || 0,
    rankPoints: num(basic.rankingPoints || basic.rankingpoints),
    csRank: basic.csRank || basic.csrank || 0,
    csRankPoints: num(basic.csRankingPoints || basic.csrankingpoints),
    maxRank: basic.maxRank || basic.maxrank || 0,
    guild: clan.clanName || clan.guildName || null,
    guildId: clan.clanId || clan.guildId || null,
    guildLevel: clan.clanLevel || clan.guildLevel || null,
    region: (basic.region || region).toUpperCase(),
    signature: social.signature || null,
    likes: num(basic.liked || basic.like),
    title: basic.title || null,
    avatarId: basic.headPic || basic.headpic || null,
    bannerId: basic.bannerId || basic.bannerid || null,
    seasonId: basic.seasonId || basic.seasonid || null,
    createdAt: basic.createAt || basic.createat || null,
    lastLogin: basic.lastLoginAt || basic.lastloginat || null,
    provider: 'jinix',
    raw: null
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

    const providers = [
      { name: 'prince', fn: providerPrince },
      { name: 'jinix',  fn: providerJinix }
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
        error: `Player dengan UID ${uid} (region ${region}) tidak ditemukan. Coba cek UID atau ganti region.`
      });
    }

    console.log(`[stalk-ff] sukses via provider: ${usedProvider}`);

    return res.status(200).json({
      success: true,
      data: {
        ...result,
        provider: usedProvider
      }
    });

  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Terjadi kesalahan di server.';
    console.error('[stalk-ff] error:', msg);
    return res.status(500).json({ success: false, error: msg });
  }
};
