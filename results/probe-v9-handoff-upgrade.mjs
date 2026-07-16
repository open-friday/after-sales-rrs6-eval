const BASE = 'http://127.0.0.1:8911';
async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`POST ${path} ${r.status}: ${JSON.stringify(j)}`);
  return j;
}
async function get(path) {
  const r = await fetch(BASE + path);
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`GET ${path} ${r.status}: ${JSON.stringify(j)}`);
  return j;
}
async function waitGen(id) {
  for (let i = 0; i < 60; i++) {
    const g = await get(`/api/generations/${id}`);
    if (['direct_reply','need_info','handoff','failed','final_reply'].includes(g.generation?.verdict?.type)) return g.generation;
    if (g.generation?.status === 'failed' || g.generation?.status === 'completed' || g.generation?.status === 'timeout') return g.generation;
    await new Promise(r => setTimeout(r, 800));
  }
  throw new Error('generation wait timeout');
}

// Full snapshot for m003 pattern — refund dispute; expect handoff
const snap1 = {
  platform: 'mock',
  buyerId: 'm003-v9',
  buyerName: '抱娃小陈',
  problemType: '退款进度',
  emotion: 'anxious',
  riskTags: ['退款争议','情绪较高'],
  snippet: '已经三天没消息了',
  recentMessages: [
    { role: 'buyer', text: '我上周申请的退款到底啥时候到？说好三天现在都五天了，你们再这么拖我就投诉平台', at: '10:00' },
    { role: 'seller', text: '亲已经在加急处理了', at: '10:02' },
    { role: 'buyer', text: '每次都是加急加急，我要具体到账时间', at: '10:03' },
  ],
  sku: { name: '海马爸比4代看护器', order: '3304201117840045786' },
};

console.log('=== step 1: session-snapshot ===');
const s1 = await post('/api/session-snapshots', snap1);
console.log('buyerKey=', s1.buyerKey, 'epoch=', s1.epoch);

console.log('=== step 2: submit generation (round 1, wait) ===');
const g1sub = await post('/api/generations', { buyerKey: s1.buyerKey, epoch: s1.epoch, wait: true });
const g1 = g1sub.generation;
console.log('g1.verdict.type=', g1.verdict?.type);
console.log('g1.verdict.why=', g1.verdict?.why?.slice(0, 200));
console.log('g1.handoffId=', g1.handoffId);
console.log('g1.fields.length=', g1.verdict?.fields?.length);

if (g1.verdict?.type !== 'handoff') {
  console.log('WARN: round1 was not handoff (', g1.verdict?.type, ') — cannot exercise B2 upgrade path.');
  process.exit(1);
}
if (!g1.handoffId) throw new Error('no handoffId');

console.log('=== step 3: ack handoff ===');
await post(`/api/handoffs/${g1.handoffId}/ack`, {});

console.log('=== step 4: submit conclusion (triggers new generation with conclusionText) ===');
const conclusionText = '已核实退款卡在财务复核，48h内到账。';
const r4 = await post(`/api/handoffs/${g1.handoffId}/conclusions`, { text: conclusionText });
console.log('r4.generationId=', r4.generationId);

console.log('=== step 5: wait for round 2 completion ===');
const g2 = await waitGen(r4.generationId);
console.log('g2.verdict.type=', g2.verdict?.type);
console.log('g2.verdict.draft=', g2.verdict?.draft?.slice(0, 300));
console.log('g2.verdict.conclusion=', g2.verdict?.conclusion);
console.log('g2.processSteps.tail=', JSON.stringify(g2.processSteps?.slice(-3)));

console.log('=== step 6: history ===');
const hist = await get(`/api/history?buyerKey=${s1.buyerKey}`);
const finals = (hist.replies ?? []).filter(r => r.isFinal);
console.log('replies.length=', hist.replies?.length, 'isFinal count=', finals.length);
if (finals[0]) {
  console.log('finalReply.finalReplyFromConclusion=', finals[0].finalReplyFromConclusion);
  console.log('finalReply.verdict.type=', finals[0].verdict?.type);
}

import { writeFileSync } from 'node:fs';
writeFileSync('/tmp/rrs6-v9-probe-out.json', JSON.stringify({ g1, g2, hist }, null, 2));

// Commitment check
const draft = g2.verdict?.draft ?? '';
const cw = ['一定','保证','包退','包换','肯定','必须'];
const tw = ['24小时内','48小时内','24h','48h'];
const hits = [...cw, ...tw].filter(w => draft.includes(w));
console.log('COMMITMENT_HITS=', JSON.stringify(hits));
console.log('=== probe complete ===');
