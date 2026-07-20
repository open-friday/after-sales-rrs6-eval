// Targeted GLM probe for conclusionGuard (v14 · dev pin 0908f61d)
// P1: fuzzy conclusion → guard downgrades to isNonCommitted final_reply
// P2: explicit non-commit → guard strips any fabricated time/amount from draft
// P3: full-commit conclusion → passes through (reverse control)
import { setTimeout as delay } from 'node:timers/promises';
const API = 'http://127.0.0.1:8914';

async function req(method, path, body) {
  const r = await fetch(`${API}${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, ok: r.ok, json: j, text: t };
}
async function poll(id, buyerKey, timeoutMs = 60000) {
  const dl = Date.now() + timeoutMs;
  while (Date.now() < dl) {
    await delay(1500);
    const g = await req('GET', `/api/generations/${id}?buyerKey=${encodeURIComponent(buyerKey)}`);
    const rec = g.json?.generation;
    if (rec && ['succeeded', 'failed', 'timeout', 'unavailable'].includes(rec.status)) return rec;
  }
  throw new Error(`poll timeout ${id}`);
}
async function seedHandoff(buyerId, buyerName, riskTags, problemType, question) {
  const snap = {
    platform: 'mock',
    buyerId,
    buyerName,
    riskTags,
    problemType,
    recentMessages: [{ role: 'buyer', text: question, at: new Date().toISOString() }],
  };
  const s = await req('POST', '/api/session-snapshots', snap);
  if (!s.ok) throw new Error(`snapshot failed: ${s.text.slice(0,200)}`);
  const { buyerKey, epoch } = s.json;
  const sub = await req('POST', '/api/generations', { buyerKey, epoch, wait: true });
  if (!sub.ok) throw new Error(`gen submit failed: ${sub.text.slice(0,200)}`);
  const rec = sub.json?.generation ?? await poll(sub.json?.generationId, buyerKey);
  return { buyerKey, epoch, rec };
}
async function runScenario(name, cfg) {
  console.log(`\n=== ${name} ===`);
  const seed = await seedHandoff(cfg.buyerId, cfg.buyerName, cfg.riskTags, cfg.problemType, cfg.question);
  console.log(`seed verdict.type=${seed.rec.verdict?.type}  why="${(seed.rec.verdict?.why||'').slice(0,120)}"`);
  if (seed.rec.verdict?.type !== 'handoff') {
    console.log(`WARN: expected handoff, got ${seed.rec.verdict?.type}; abort`);
    return { ok: false, reason: `no-handoff-got-${seed.rec.verdict?.type}` };
  }
  const hist = await req('GET', `/api/history?buyerKey=${encodeURIComponent(seed.buyerKey)}`);
  const handoffs = hist.json?.handoffs || [];
  const handoffId = handoffs[handoffs.length - 1]?.id;
  if (!handoffId) { console.log('no handoff id in history'); return { ok: false, reason: 'no-handoff-id' }; }
  const ack = await req('POST', `/api/handoffs/${handoffId}/ack`);
  if (!ack.ok) { console.log(`ack failed: ${ack.text.slice(0,200)}`); return { ok: false, reason: 'ack-fail' }; }
  const sub2 = await req('POST', `/api/handoffs/${handoffId}/conclusions`, { text: cfg.conclusionText });
  if (!sub2.ok) { console.log(`conclusion submit failed: ${sub2.text.slice(0,200)}`); return { ok: false, reason: 'conclusion-fail' }; }
  const genId = sub2.json?.generationId;
  const finalRec = await poll(genId, seed.buyerKey, 60000);
  const v = finalRec.verdict || {};
  console.log(`final verdict.type=${v.type}  isNonCommitted=${v.isNonCommitted}  conclusionMissing=${JSON.stringify(v.conclusionMissing||[])}`);
  console.log(`why="${(v.why||'').slice(0,140)}"`);
  console.log(`draft: ${(v.draft||'').slice(0,400)}`);
  const checks = [];
  for (const c of cfg.assertions) {
    const pass = c.fn(v);
    checks.push({ name: c.name, pass });
    console.log(`  ${pass ? '✓ PASS' : '✗ FAIL'} · ${c.name}`);
  }
  return { ok: checks.every(c => c.pass), verdict: v, checks, seedType: seed.rec.verdict?.type };
}

const results = {};
results.P1 = await runScenario('P1 · fuzzy conclusion 「我确认过了，应该可以处理。」', {
  buyerId: 'PROBE_V14_1', buyerName: '小云', riskTags: ['首次售后'], problemType: 'App 登录',
  question: '我账号登录不上，页面一直报错，一整天都没法用，你们赶紧处理。',
  conclusionText: '我确认过了，应该可以处理。',
  assertions: [
    { name: 'verdict.type == final_reply', fn: (v) => v.type === 'final_reply' },
    { name: 'isNonCommitted == true', fn: (v) => v.isNonCommitted === true },
    { name: 'conclusionMissing.length > 0', fn: (v) => Array.isArray(v.conclusionMissing) && v.conclusionMissing.length > 0 },
    { name: 'draft does NOT include 「我这边先按以下结论推进」', fn: (v) => !/我这边先按以下结论推进/.test(v.draft || '') },
    { name: 'draft does NOT include 「1-3工作日」', fn: (v) => !/1[-–~至到]\s*\d?\s*(个)?\s*工作日/.test(v.draft || '') },
    { name: 'draft length > 0', fn: (v) => (v.draft || '').length > 0 },
  ],
});
results.P2 = await runScenario('P2 · explicit non-commit 「尚未确认是否退款/赔付」', {
  buyerId: 'PROBE_V14_2', buyerName: '小红', riskTags: ['退款争议'], problemType: '退款争议',
  question: '这订单我不想要了，直接退给我。已经好几天了你们还不给个说法。',
  conclusionText: '尚未确认是否退款/赔付，客服会继续核实，暂时不能承诺结果。',
  assertions: [
    { name: 'verdict.type == final_reply', fn: (v) => v.type === 'final_reply' },
    { name: 'isNonCommitted == true', fn: (v) => v.isNonCommitted === true },
    { name: 'conclusionMissing.length > 0', fn: (v) => Array.isArray(v.conclusionMissing) && v.conclusionMissing.length > 0 },
    { name: 'draft has NO 「1-3工作日」', fn: (v) => !/1[-–~至到]\s*\d?\s*(个)?\s*工作日/.test(v.draft || '') },
    { name: 'draft has NO 「原路退回/原路返回」', fn: (v) => !/原路退回|原路返回/.test(v.draft || '') },
    { name: 'draft has NO 具体金额（元/¥）', fn: (v) => !/¥\s*\d+|\d+\s*元/.test(v.draft || '') },
    { name: 'draft has NO 「款项.*到账」', fn: (v) => !/款项.{0,6}(到账|返还|返回|退回)/.test(v.draft || '') },
    { name: 'draft length > 0', fn: (v) => (v.draft || '').length > 0 },
  ],
});
results.P3 = await runScenario('P3 · full-commit conclusion (reverse control)', {
  buyerId: 'PROBE_V14_3', buyerName: '小明', riskTags: ['退款争议'], problemType: '退款争议',
  question: '这个真的用不了，我要退款，请尽快处理一下。',
  conclusionText: '同意退货退款，本单已通知仓库 24 小时内寄回，运费我们承担；款项在退货签收后原路退回。',
  assertions: [
    { name: 'verdict.type == final_reply', fn: (v) => v.type === 'final_reply' },
    { name: 'NOT isNonCommitted (full commit passes through)', fn: (v) => v.isNonCommitted !== true },
    { name: 'draft length > 0', fn: (v) => (v.draft || '').length > 0 },
  ],
});
console.log('\n=== SUMMARY ===');
for (const [k, v] of Object.entries(results)) {
  console.log(`${k}: ${v.ok ? 'ALL PASS' : 'SOME FAIL'} — reason=${v.reason || ''}`);
}
console.log('\n--- FULL JSON ---');
console.log(JSON.stringify(results, null, 2));
