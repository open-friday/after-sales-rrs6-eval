#!/usr/bin/env node
// FL-05：生成服务配置缺失 → 入队前判不可用 + 可复制降级文案（PRD §6.9 / AC-25）
//
// 这条不需要模型参与：后端在 runtime.isConfigured() 为假时，在调用模型之前就返回。
// 所以用真后端代码 + 空 GLM 环境跑，不构成「mock 模型输出」。
//
//   BACKEND_DIR=/path/to/after-sales-rrs6-backend node run-local-config-missing.mjs
//
// 真机 UI 侧的 AC-25（侧边栏不进入无限生成、不泄露变量名）由 QA:rrs6-38d10fdb 复验。

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BACKEND_DIR = process.env.BACKEND_DIR || '/tmp/rrs6-be';
const PORT = Number(process.env.PORT || 18797);
const BASE = `http://127.0.0.1:${PORT}`;

const dataDir = mkdtempSync(join(tmpdir(), 'rrs6-eval-fl05-'));
const checks = [];
const add = (id, pass, detail) => { checks.push({ id, pass, level: 'fail', detail }); console.log(`${pass ? '✅' : '❌'} ${id} — ${detail}`); };

// 关键：显式剥掉所有 GLM/ACP 凭据变量，模拟「组织变量未注入 / 桥接缺失」
const env = { ...process.env };
for (const k of Object.keys(env)) {
  if (/^(GLM_|Z_AI_|ACP_GLM_|HERMES_ACP_)/.test(k)) delete env[k];
}
env.PORT = String(PORT);
env.HOST = '127.0.0.1';
env.DATA_DIR = dataDir;
delete env.BACKEND_ACCESS_TOKEN; // 本地实例不设 token，便于直连
env.LOG_LEVEL = 'error';

// 用后端仓自己的 tsx（package.json 的 dev 脚本同款），不是另起一套跑法
const child = spawn('node', ['--import', 'tsx', 'src/server.ts'], {
  cwd: BACKEND_DIR, env, stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (d) => { stderr += String(d); });
child.stdout.on('data', () => {});

async function waitHealth(ms = 25000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return r.json();
    } catch { /* 还没起 */ }
    await new Promise((s) => setTimeout(s, 400));
  }
  throw new Error(`后端未在 ${ms}ms 内就绪。stderr:\n${stderr.slice(0, 800)}`);
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, ok: r.ok, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}

try {
  const h = await waitHealth();
  console.log(`[fl05] 后端已起 ${BASE} → ${JSON.stringify(h)}`);
  add('health_reports_unconfigured', h.modelConfigured === false,
    `空 GLM 环境下 /health.modelConfigured=${h.modelConfigured}（应为 false）`);

  const snap = await post('/api/session-snapshots', {
    platform: 'mock', buyerId: 'fl05_probe', buyerName: '小满不满_',
    snippet: '刚买的看护器一直连不上',
    recentMessages: [{ role: 'buyer', text: '刚买的看护器一直连不上，App 里一直显示离线。', at: '2026-07-15T10:00:00+08:00' }],
    sku: { name: '【4K旗舰】海马爸比4代 AI智能婴儿看护器', order: '3304201117840045784' },
  });
  const { buyerKey, epoch } = snap.json;

  const gen = await post('/api/generations', { buyerKey, epoch, wait: true });
  const rec = gen.json?.generation;
  console.log('[fl05] generation =', JSON.stringify(rec, null, 2).slice(0, 900));

  add('not_queued', gen.json?.queued === false,
    `queued=${gen.json?.queued}（PRD §6.9：不得把配置错误伪装成排队）`);
  add('status_unavailable', rec?.status === 'unavailable',
    `status=${rec?.status}（应为 unavailable）`);
  add('has_business_step', (rec?.processSteps ?? []).some((s) => s.label.includes('生成服务暂时不可用')),
    `工作过程含业务态提示: ${(rec?.processSteps ?? []).map((s) => s.label).join(' → ')}`);
  add('no_model_call', (rec?.totalMs ?? 0) < 1000,
    `totalMs=${rec?.totalMs}（应在入队前就返回，不该有模型往返耗时）`);

  // 整个响应体不得带出凭据值 / 原始 No API key found / 异常栈
  const body = gen.text;
  const leaks = [/No API key found/i, /sk-[A-Za-z0-9]{6,}/, /Z_AI_API_KEY|GLM_API_KEY|ACP_GLM_BASE_URL|HERMES_ACP_COMMAND/, /at .*\(.*:\d+:\d+\)/];
  const hit = leaks.filter((re) => re.test(body)).map(String);
  add('no_credential_leak_in_payload', hit.length === 0,
    hit.length ? `响应体命中: ${hit.join(', ')}` : '响应体未出现凭据值/原始 No API key found/异常栈');

  // 备注：failureReason=ACP_ENV_MISSING 是内部代号，扩展端 sidepanel/index.ts:375
  // 已映射为「生成服务暂时不可用」，不直接上屏——真机由 QA:38d10fdb 复验。
  console.log(`[fl05] failureReason=${rec?.failureReason}（扩展端映射为业务文案，未直接上屏）`);

  const passed = checks.filter((c) => c.pass).length;
  mkdirSync('results', { recursive: true });
  writeFileSync('results/fl05-local-config-missing.json', JSON.stringify({
    scenario: 'FL-05', ranAt: new Date().toISOString(), backendDir: BACKEND_DIR,
    health: h, generation: rec, rawResponse: gen.text.slice(0, 2000), checks,
    pass: passed === checks.length,
  }, null, 2));
  console.log(`\n[fl05] ${passed}/${checks.length} 通过 · 证据写入 results/fl05-local-config-missing.json`);
  child.kill('SIGTERM');
  process.exit(passed === checks.length ? 0 : 1);
} catch (e) {
  console.error('[fl05] 跑挂:', e.message);
  child.kill('SIGTERM');
  process.exit(2);
}
