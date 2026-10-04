/* ============================================================
   FORTECH FIRST TOOLS — API: Netlify Quick Publish
   Endpoint : POST /api/netlify
   Body     : { name, files: [{ path, base64, encoding }] }
   Token    : process.env.NETLIFY_TOKEN
   ============================================================ */

const NETLIFY_API = 'https://api.netlify.com/api/v1';
const MAX_PAYLOAD_SIZE = 4 * 1024 * 1024;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function sanitizeName(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 52);
}

function b64Decode(str) {
  return Buffer.from(str, 'base64');
}

function sha1(buffer) {
  const { createHash } = require('node:crypto');
  return createHash('sha1').update(buffer).digest('hex');
}

function buildFiles(filesInput) {
  const files = [];
  for (const f of filesInput) {
    const path = String(f.path || '').replace(/^\/+/, '').replace(/\\/g, '/');
    const b64 = String(f.base64 || '');
    if (!path || !b64) continue;

    const buffer = b64Decode(b64);
    files.push({
      path: '/' + path,
      buffer,
      sha: sha1(buffer),
      size: buffer.length
    });
  }
  return files;
}

/* ---------- Unlock site: clear password + disable protection ---------- */
async function unlockSite(token, siteId) {
  try {
    const res = await fetch(`${NETLIFY_API}/sites/${siteId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        password: '',
        password_context: 'all',
        prevent_non_admin_access: false,
        sso_protection: false
      })
    });
    if (res.ok) {
      console.log(`[netlify] site ${siteId} unlocked`);
      return await res.json();
    }
    const errText = await res.text();
    console.warn(`[netlify] unlock return ${res.status}:`, errText.slice(0, 200));
  } catch (e) {
    console.warn('[netlify] unlock error:', e.message);
  }
  return null;
}

async function getOrCreateSite(token, name) {
  const listRes = await fetch(`${NETLIFY_API}/sites?name=${encodeURIComponent(name)}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (listRes.ok) {
    const sites = await listRes.json();
    const found = sites.find(s => s.name === name);
    if (found) {
      /* Pastikan site lama juga di-unlock */
      await unlockSite(token, found.id);
      return found;
    }
  }

  const createRes = await fetch(`${NETLIFY_API}/sites`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name,
      /* Set langsung biar public dari awal */
      password: '',
      prevent_non_admin_access: false
    })
  });

  if (!createRes.ok) {
    const errBody = await createRes.text();
    let errMsg = errBody.slice(0, 300);
    try {
      const j = JSON.parse(errBody);
      errMsg = j.message || j.error || errMsg;
    } catch {}

    if (createRes.status === 401 || createRes.status === 403) {
      throw new Error('Token Netlify tidak valid atau kadaluarsa.');
    }
    if (createRes.status === 422 && /already exists|unique/i.test(errMsg)) {
      throw new Error(`Nama "${name}" sudah dipakai. Coba nama lain.`);
    }
    throw new Error(`Gagal buat site (${createRes.status}): ${errMsg}`);
  }

  const site = await createRes.json();

  /* PATCH untuk mastiin site public */
  await unlockSite(token, site.id);

  return site;
}

async function deployFiles(token, siteId, files) {
  const manifest = {};
  for (const f of files) {
    manifest[f.path] = f.sha;
  }

  const deployRes = await fetch(`${NETLIFY_API}/sites/${siteId}/deploys`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ files: manifest })
  });

  if (!deployRes.ok) {
    const errBody = await deployRes.text();
    throw new Error(`Gagal create deploy (${deployRes.status}): ${errBody.slice(0, 200)}`);
  }

  const deploy = await deployRes.json();
  const deployId = deploy.id;
  const required = deploy.required || [];
  const requiredSet = new Set(required);

  const uploadPromises = files
    .filter(f => requiredSet.has(f.path))
    .map(f => uploadFile(token, deployId, f));

  await Promise.all(uploadPromises);
  return deploy;
}

async function uploadFile(token, deployId, file) {
  const res = await fetch(`${NETLIFY_API}/deploys/${deployId}/files${file.path}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/octet-stream'
    },
    body: file.buffer
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Upload ${file.path} gagal (${res.status}): ${errBody.slice(0, 150)}`);
  }
  return true;
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Gunakan POST.' });
  }

  try {
    const token = String(process.env.NETLIFY_TOKEN || '').trim();

    if (!token) {
      return res.status(500).json({
        success: false,
        error: 'Server belum dikonfigurasi. Set environment variable NETLIFY_TOKEN di Vercel Dashboard.'
      });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const rawName = String(body.name || '').trim();
    const filesInput = Array.isArray(body.files) ? body.files : [];

    if (!rawName) return res.status(400).json({ success: false, error: 'Nama site wajib diisi.' });
    if (!filesInput.length) return res.status(400).json({ success: false, error: 'Tidak ada file untuk dideploy.' });

    const siteName = sanitizeName(rawName);
    if (!siteName || siteName.length < 2) {
      return res.status(400).json({ success: false, error: 'Nama site tidak valid.' });
    }

    const files = buildFiles(filesInput);
    if (!files.length) return res.status(400).json({ success: false, error: 'File tidak valid.' });

    const hasIndex = files.some(f => f.path === '/index.html');
    if (!hasIndex) {
      return res.status(400).json({ success: false, error: 'Harus ada index.html di root project.' });
    }

    const totalSize = files.reduce((s, f) => s + f.size, 0);
    if (totalSize > MAX_PAYLOAD_SIZE) {
      return res.status(400).json({
        success: false,
        error: `Total ukuran terlalu besar (${(totalSize/1024/1024).toFixed(1)} MB). Maks 4 MB.`
      });
    }

    console.log(`[netlify] site="${siteName}" files=${files.length} size=${(totalSize/1024).toFixed(1)}KB`);

    const site = await getOrCreateSite(token, siteName);
    const deploy = await deployFiles(token, site.id, files);

    const siteUrl = site.ssl_url || site.url || `https://${siteName}.netlify.app`;
    const cleanUrl = siteUrl.replace(/^http:/, 'https:');

    console.log(`[netlify] sukses: ${cleanUrl}`);

    return res.status(200).json({
      success: true,
      data: {
        url: cleanUrl,
        cleanUrl: cleanUrl,
        readyState: deploy.state || 'processing',
        siteId: site.id,
        deployId: deploy.id,
        name: site.name || siteName,
        fileCount: files.length,
        files: files.map(f => f.path),
        inspectorUrl: `https://app.netlify.com/sites/${site.name}/deploys/${deploy.id}`,
        note: 'URL aktif dalam 15-45 detik.'
      }
    });

  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Terjadi kesalahan di server.';
    console.error('[netlify]', msg);
    return res.status(500).json({ success: false, error: msg });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '4mb' } }
};
