// 后端真链路客户端。只打真后端、真 GLM——本仓不存在任何模型桩。
const API = process.env.API_BASE || 'http://140.143.131.216:8797';
const TOKEN = process.env.API_TOKEN || '';

function headers() {
  return { 'content-type': 'application/json', ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) };
}

/**
 * 只对**传输层**故障重试（ECONNRESET / socket hang up 等）。
 * 绝不对 HTTP 错误码或模型输出重试 —— 那会把「被测系统的失败」洗成「通过」。
 * 2026-07-15 首跑就是被一次 ECONNRESET 打断的（详见报告 O-3）。
 */
async function withRetry(fn, label, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const transient = /ECONNRESET|socket hang up|ETIMEDOUT|EPIPE|ECONNREFUSED|fetch failed/i.test(
        String(e?.cause?.code ?? '') + String(e?.message ?? ''),
      );
      if (!transient || i === tries) throw e;
      console.log(`[api] ${label} 传输层故障(${e?.cause?.code ?? e.message})，${i}/${tries} 退避重试`);
      await new Promise((s) => setTimeout(s, 2000 * i));
    }
  }
  throw lastErr;
}

export async function post(path, body, { allowFail = false } = {}) {
  return withRetry(async () => {
    const r = await fetch(`${API}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON 原样带出 */ }
    if (!r.ok && !allowFail) throw new Error(`POST ${path} -> ${r.status}: ${text.slice(0, 300)}`);
    return { status: r.status, ok: r.ok, json, text };
  }, `POST ${path}`);
}

export async function get(path) {
  return withRetry(async () => {
    const r = await fetch(`${API}${path}`, { headers: headers() });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}: ${text.slice(0, 300)}`);
    return json;
  }, `GET ${path}`);
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
