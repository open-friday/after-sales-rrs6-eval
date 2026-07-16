#!/usr/bin/env node
// 把合并后的结果压成产物报告要用的几张表。
//   node report-tables.mjs results/run-r6-ext.json
//
// 关键口径：**45s 硬超时不是路由判定**。
// 我这台沙箱 P50≈26.5s（真机 13.1s），3 实例并行时尾部会压过 45s 闸。
// 那是"样本没取到"，不是"模型判错了"——所以路由统计里把它单列，不算 dev 的账。
// 凡 45s 整的 failed，先归因到自己（第 4、6 轮各犯过一次）。
import { readFileSync } from 'node:fs';

const d = JSON.parse(readFileSync(process.argv[2] ?? 'results/run-r6-ext.json', 'utf8'));
const isRigTimeout = (s) => s.status === 'timeout' || (s.verdictType === 'failed' && (s.totalMs ?? 0) >= 44000);

let tot = 0, pass = 0, rig = 0;
const rows = [];
for (const r of d.results) {
  const eff = r.samples.filter((s) => !isRigTimeout(s));
  const rigN = r.samples.length - eff.length;
  const effPass = eff.filter((s) => s.pass).length;
  const types = {};
  for (const s of eff) types[s.verdictType ?? s.status] = (types[s.verdictType ?? s.status] ?? 0) + 1;
  tot += eff.length; pass += effPass; rig += rigN;
  const allowed = r.samples[0]?.checks?.find((c) => c.id === 'route')?.detail?.match(/\[([^\]]+)\]/)?.[1] ?? '';
  rows.push({
    id: r.id, cat: r.category, title: r.title,
    holdout: !!r.holdout, burned: !!r.burned, advisory: !!r.advisory,
    n: eff.length, pass: effPass, rig: rigN,
    ok: eff.length > 0 && effPass === eff.length,
    types, allowed,
    fallbackN: r.fallbackN ?? 0, fallbackTypes: r.fallbackTypes,
    parseFail: r.parseFailFirstTryN ?? 0,
    fails: [...new Set(r.samples.flatMap((s) => (s.fails ?? []).map((f) => f.id)))].filter((x) => x !== 'route' || true),
  });
}

const show = (rs) => rs.map((r) =>
  `${r.ok ? '✅' : '❌'} ${r.id} ${r.pass}/${r.n}${r.rig ? ` (+${r.rig}rig)` : ''} ${JSON.stringify(r.types)} 期望=[${r.allowed}]${r.advisory ? ' [观察]' : ''}${r.fallbackN ? ` 兜底${r.fallbackN}→${JSON.stringify(r.fallbackTypes)}` : ''}${!r.ok ? '  FAILS=' + JSON.stringify(r.fails) : ''}`
).join('\n');

const main = rows.filter((r) => !r.holdout);
const hoFresh = rows.filter((r) => r.holdout && !r.burned);
const hoBurned = rows.filter((r) => r.holdout && r.burned);

console.log('══ 主场景 ══'); console.log(show(main));
console.log('\n══ 新留出集（本轮泛化证据）══'); console.log(show(hoFresh));
console.log('\n══ 已烧留出集（回归）══'); console.log(show(hoBurned));

const gate = rows.filter((r) => !r.advisory);
console.log(`\n══ 汇总 ══`);
console.log(`有效样本 ${pass}/${tot} (${((pass / tot) * 100).toFixed(1)}%) · 我的跑测环境丢弃(45s超时) ${rig} 条`);
console.log(`场景全过(作闸) ${gate.filter((r) => r.ok).length}/${gate.length} · 观察项 ${rows.filter((r) => r.advisory).length}`);
console.log(`❌ 未全过(作闸): ${gate.filter((r) => !r.ok).map((r) => r.id).join(',') || '无'}`);
const fbTot = rows.reduce((n, r) => n + r.fallbackN, 0);
const pfTot = rows.reduce((n, r) => n + r.parseFail, 0);
console.log(`兜底 ${fbTot} 次 · 首解析失败 ${pfTot}/${tot} (${((pfTot / tot) * 100).toFixed(1)}%)`);
const fbTypes = {};
for (const r of rows) for (const [k, v] of Object.entries(r.fallbackTypes ?? {})) fbTypes[k] = (fbTypes[k] ?? 0) + v;
console.log(`兜底落到: ${JSON.stringify(fbTypes)}`);
