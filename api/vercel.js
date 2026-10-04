/* ============================================================
   FORTECH FIRST TOOLS — API: Vercel Quick Publish
   Endpoint : POST /api/vercel
   Body     : { name, files: [{ path, base64, encoding }] }
   Token    : process.env.VERCEL_TOKEN (dari Vercel env var)
   ============================================================ */

const VERCEL_API_BASE = 'https://api.vercel.com';
const VERCEL_API_DEPLOY = `${VERCEL_API_BASE}/v13/deployments`;
const MAX_PAYLOAD_SIZE = 4 * 1024 * 1024;

/* ---------- CORS ---------- */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

/* ---------- Sanitasi nama project ---------- */
function sanitizeName(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 52);
}

/* ---------- Base64 decode ---------- */
function b64Decode(str) {
  return Buffer.from(str, 'base64').toString('utf8');
}

/* ---------- Susun files array untuk Vercel ---------- */
function buildFiles(filesInput) {
  const files = [];
  for (const f of filesInput) {
    const path = String(f.path || '').replace(/^\/+/, '').replace(/\\/g, '/');
    const b64 = String(f.base64 || '');
    const enc = f.encoding === 'base64' ? 'base64' : 'utf-8';
    if (!path || !b64) continue;

    if (enc === 'base64') {
      files.push({ file: path, data: b64, encoding: 'base64' });
    } else {
      files.push({ file: path, data: b64Decode(b64) });
    }
  }
  return files;
}

/* ---------- Parse error Vercel ---------- */
function parseVercelError(status, errBody) {
  let errJson = null;
  try { errJson = JSON.parse(errBody); } catch {}
  const msg = (errJson && errJson.error && errJson.error.message)
    || (errJson && errJson.message)
    || errBody.slice(0, 300);

  if (status === 401 || status === 403) return 'Token Vercel tidak valid atau kadaluarsa. Cek env var VERCEL_TOKEN.';
  if (status === 409 || /already exists|conflict/i.test(msg)) return 'Nama project sudah dipakai. Coba nama lain.';
  if (status === 402 || /payment|limit/i.test(msg)) return 'Akun Vercel sudah mencapai limit.';
  return `Deploy gagal (${status}): ${msg}`;
}

/* ---------- Handler ---------- */
module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Gunakan POST.' });
  }

  try {
    /* Token dari env var */
    const token = String(process.env.VERCEL_TOKEN || '').trim();

    if (!token) {
      return res.status(500).json({
        success: false,
        error: 'Server belum dikonfigurasi. Set environment variable VERCEL_TOKEN di Vercel Dashboard.'
      });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const rawName = String(body.name || '').trim();
    const filesInput = Array.isArray(body.files) ? body.files : [];

    if (!rawName) {
      return res.status(400).json({ success: false, error: 'Nama project wajib diisi.' });
    }
    if (!filesInput.length) {
      return res.status(400).json({ success: false, error: 'Tidak ada file untuk dideploy.' });
    }

    const projectName = sanitizeName(rawName);
    if (!projectName || projectName.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Nama project tidak valid (min 2 karakter, hanya huruf/angka/dash).'
      });
    }

    const files = buildFiles(filesInput);
    if (!files.length) {
      return res.status(400).json({ success: false, error: 'File tidak valid setelah parsing.' });
    }

    const hasIndex = files.some(f => f.file === 'index.html');
    if (!hasIndex) {
      return res.status(400).json({ success: false, error: 'Harus ada index.html di root project.' });
    }

    const deployPayload = {
      name: projectName,
      files,
      projectSettings: {
        framework: null,
        buildCommand: null,
        outputDirectory: null,
        rootDirectory: null,
        installCommand: null,
        devCommand: null
      },
      target: 'production'
    };

    const payloadStr = JSON.stringify(deployPayload);
    if (payloadStr.length > MAX_PAYLOAD_SIZE) {
      return res.status(400).json({
        success: false,
        error: `Payload terlalu besar (${(payloadStr.length/1024/1024).toFixed(1)} MB). Maks ${MAX_PAYLOAD_SIZE/1024/1024} MB.`
      });
    }

    console.log(`[vercel] deploying "${projectName}" (${files.length} files, ${(payloadStr.length/1024).toFixed(1)} KB)`);

    const deployUrl = `${VERCEL_API_DEPLOY}?forceNew=1&skipAutoDetectionConfirmation=1`;
    const deployRes = await fetch(deployUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: payloadStr
    });

    if (!deployRes.ok) {
      const errBody = await deployRes.text();
      throw new Error(parseVercelError(deployRes.status, errBody));
    }

    const deployJson = await deployRes.json();

    console.log(`[vercel] sukses: https://${projectName}.vercel.app`);

    return res.status(200).json({
      success: true,
      data: {
        url: `https://${deployJson.url}`,
        cleanUrl: `https://${projectName}.vercel.app`,
        readyState: deployJson.readyState || deployJson.status || 'QUEUED',
        inspectorUrl: deployJson.inspectorUrl,
        projectId: deployJson.projectId,
        name: deployJson.name || projectName,
        fileCount: files.length,
        files: files.map(f => f.file),
        note: 'URL aktif dalam 30-90 detik.'
      }
    });

  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Terjadi kesalahan di server.';
    console.error('[vercel]', msg);
    return res.status(500).json({ success: false, error: msg });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '4mb' } }
};
