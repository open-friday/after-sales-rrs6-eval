#!/usr/bin/env node
// 把 results/run-*.json 汇成产物报告要用的表格 + 逐条判定理由骨架。
//   node summarize.mjs results/run-r1.json
import { readFileSync } from 'node:fs';
import { CATEGORY_LABEL } from './scenarios.mjs';

const path = process.argv[2] ?? 'results/run-r1.json';
const d = JSON.parse(readFileSync(path, 'utf8'));

console.log(`# ${d.runId} · ${d.target} · ${d.startedAt}`);
console.log(`health: ${JSON.stringify(d.health)}`);
console.log(`\n## 汇总: ${d.summary.passed}/${d.summary.total} (${d.summary.passRatePct}%) · warn=${d.summary.warnCount}`);
for (const [c, v] of Object.entries(d.summary.byCategory)) {
  console.log(`  ${CATEGORY_LABEL[c]}: ${v.pass}/${v.total}`);
}
console.log(`  时延: n=${d.summary.latency.n} p50=${d.summary.latency.p50}ms p95=${d.summary.latency.p95}ms max=${d.summary.latency.max}ms`);

console.log('\n## 稳定性');
for (const s of d.stability ?? []) {
  console.log(`  ${s.id}: n=${s.n} 一致率=${(s.ratio * 100).toFixed(0)}% 众数=${s.topType} 分布=${JSON.stringify(s.counts)} 跨风险翻转=${s.riskFlip}`);
}

console.log('\n## 失败明细');
for (const r of d.results.filter((x) => !x.pass)) {
  console.log(`\n### ❌ ${r.id} [${CATEGORY_LABEL[r.category]}] ${r.title}`);
  console.log(`判定=${r.verdictType} status=${r.status} ${r.totalMs}ms`);
  for (const f of r.fails) console.log(`  - [${f.id}] ${f.detail}`);
  if (r.error) console.log(`  - 跑挂: ${r.error}`);
  const o = r.output ?? {};
  console.log(`  why: ${(o.why ?? '').slice(0, 200)}`);
  if (o.draft) console.log(`  draft: ${o.draft.slice(0, 400)}`);
  if (o.missing) console.log(`  missing: ${JSON.stringify(o.missing)}`);
  if (o.acceptance) console.log(`  acceptance: ${o.acceptance.slice(0, 300)}`);
  if (o.fields) console.log(`  fields: ${o.fields.map(([k]) => k).join('/')}`);
}

console.log('\n## warn（需人工复核）');
for (const r of d.results.filter((x) => x.warns?.length)) {
  for (const w of r.warns) console.log(`  ${r.id}: [${w.id}] ${w.detail}`);
}

console.log('\n## 通过的场景一览');
for (const r of d.results.filter((x) => x.pass)) {
  console.log(`  ✅ ${r.id} ${r.verdictType ?? '-'} ${r.totalMs ?? '-'}ms — ${r.title}`);
}
