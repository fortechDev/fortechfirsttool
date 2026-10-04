/* ============================================================
   FORTECH FIRST TOOLS — API: File to Link
   Endpoint : POST /api/imglink
   Body     : { filename, mime, base64 }
   Provider : Catbox + Telegra.ph + 0x0.st (paralel)
   ============================================================ */

const MAX_SIZE = 4 * 1024 * 1024;
const TIMEOUT_MS = 22000;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function withTimeout(ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(t) };
}

async function uploadCatbox(buffer, filename, mime) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', new Blob([buffer], { type: mime }), filename);
  const t = withTimeout(TIMEOUT_MS);
  try {
    const res = await fetch('https://catbox.moe/user/api.php', {
      method: 'POST', body: form, signal: t.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = (await res.text()).trim();
    if (!text.startsWith('http')) throw new Error(text.slice(0, 100) || 'Response tidak valid');
    return text;
  } finally { t.clear(); }
}

async function uploadTelegraph(buffer, filename, mime) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), filename);
  const t = withTimeout(TIMEOUT_MS);
  try {
    const res = await fetch('https://telegra.ph/upload', {
      method: 'POST', body: form, signal: t.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json) || !json[0] || !json[0].src) {
      throw new Error((json && (json.error || (json[0] && json[0].error))) || 'Response tidak valid');
    }
    return 'https://telegra.ph' + json[0].src;
  } finally { t.clear(); }
}

async function upload0x0(buffer, filename, mime) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), filename);
  const t = withTimeout(TIMEOUT_MS);
  try {
    const res = await fetch('https://0x0.st', {
      method: 'POST',
      headers: { 'User-Agent': 'FortechTools/1.0 (+https://fortech.dev)' },
      body: form,
      signal: t.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = (await res.text()).trim();
    if (!text.startsWith('http')) throw new Error(text.slice(0, 100) || 'Response tidak valid');
    return text;
  } finally { t.clear(); }
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed. Gunakan POST.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const filename = String(body.filename || 'file').slice(0, 120);
    const mime = String(body.mime || 'application/octet-stream');
    const b64 = String(body.base64 || '');

    if (!b64) return res.status(400).json({ success: false, error: 'File wajib diupload.' });

    const buffer = Buffer.from(b64, 'base64');
    if (!buffer.length) return res.status(400).json({ success: false, error: 'File kosong.' });
    if (buffer.length > MAX_SIZE) {
      return res.status(400).json({
        success: false,
        error: `Ukuran file ${(buffer.length/1024/1024).toFixed(1)} MB melebihi batas 4 MB.`
      });
    }

    console.log(`[imglink] upload "${filename}" (${(buffer.length/1024).toFixed(1)} KB)`);

    const tasks = [
      { provider: 'catbox',    label: 'Catbox',     fn: uploadCatbox },
      { provider: 'telegraph', label: 'Telegra.ph', fn: uploadTelegraph },
      { provider: '0x0',       label: '0x0.st',     fn: upload0x0 }
    ];

    const results = await Promise.all(tasks.map(async (t) => {
      try {
        const url = await t.fn(buffer, filename, mime);
        console.log(`[imglink] ${t.label} OK`);
        return { provider: t.provider, label: t.label, success: true, url };
      } catch (e) {
        console.warn(`[imglink] ${t.label} gagal:`, e.message);
        return { provider: t.provider, label: t.label, success: false, error: e.message };
      }
    }));

    const successCount = results.filter(r => r.success).length;
    if (successCount === 0) {
      return res.status(500).json({
        success: false,
        error: 'Semua provider gagal mengupload. Coba lagi atau ganti file.',
        data: { results }
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        filename,
        size: buffer.length,
        successCount,
        total: results.length,
        results
      }
    });
  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Terjadi kesalahan di server.';
    console.error('[imglink]', msg);
    return res.status(500).json({ success: false, error: msg });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '6mb' } }
};
