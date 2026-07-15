// 后端真链路客户端。只打真后端、真 GLM——本仓不存在任何模型桩。
const API = process.env.API_BASE || 'http://140.143.131.216:8797';
const TOKEN = process.env.API_TOKEN || '';

function headers() {
  return { 'content-type': 'application/json', ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) };
}

export async function post(path, body, { allowFail = false } = {}) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON 原样带出 */ }
  if (!r.ok && !allowFail) throw new Error(`POST ${path} -> ${r.status}: ${text.slice(0, 300)}`);
  return { status: r.status, ok: r.ok, json, text };
}

export async function get(path) {
  const r = await fetch(`${API}${path}`, { headers: headers() });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}: ${text.slice(0, 300)}`);
  return json;
}

export async function health() {
  const r = await fetch(`${API}/health`);
  return r.json();
}

/** 提交一次生成并等结果（wait=true 走后端的同步等待通道） */
export async function generate(body) {
  const t0 = Date.now();
  const r = await post('/api/generations', { ...body, wait: true });
  return { rec: r.json?.generation, clientMs: Date.now() - t0, raw: r.json };
}

/** 202 异步提交 → 轮询到终态 */
export async function generateAndPoll(body, { buyerKey, timeoutMs = 60000 }) {
  const t0 = Date.now();
  const sub = await post(body.__path ?? '/api/generations', body.__body ?? body);
  const id = sub.json?.generationId;
  if (!id) throw new Error(`no generationId: ${sub.text.slice(0, 200)}`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((s) => setTimeout(s, 1500));
    const g = await get(`/api/generations/${id}?buyerKey=${encodeURIComponent(buyerKey)}`);
    const rec = g?.generation;
    if (rec && ['succeeded', 'failed', 'timeout', 'unavailable'].includes(rec.status)) {
      return { rec, clientMs: Date.now() - t0 };
    }
  }
  throw new Error(`poll timeout after ${timeoutMs}ms (gen=${id})`);
}

export const API_BASE = API;
