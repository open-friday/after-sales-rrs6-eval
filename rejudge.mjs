#!/usr/bin/env node
// 用当前 judge.mjs 重判一份既有结果文件（不重跑模型）。
//
//   node rejudge.mjs results/run-r2.json results/run-r2-rejudged.json
//
// 为什么能这么干：run-eval.mjs 落盘的是后端**原始 verdict**，不是判定结论。
// 判定器改了就能对同一批真实输出重算——这正是「证据留原文」的价值：
// 修正量尺不需要重新打模型，也不会因为重跑而换一批样本来回避问题。

import { readFileSync, writeFileSync } from 'node:fs';
import { SCENARIOS, CATEGORY_LABEL } from './scenarios.mjs';
import { judgeOne } from './judge.mjs';

const src = process.argv[2] ?? 'results/run-r2.json';
const dst = process.argv[3] ?? src.replace(/\.json$/, '-rejudged.json');
const d = JSON.parse(readFileSync(src, 'utf8'));
const byId = new Map(SCENARIOS.map((s) => [s.id, s]));

const results = d.results.map((r) => {
  const sc = byId.get(r.id);
  if (!sc || r.error) return r;
  // stale-epoch / isolation 这类靠 extraChecks 判定的，原样保留
  const extra = (r.checks ?? []).filter((c) => c.id.startsWith('iso_') || c.id.startsWith('stale_'));
  if (sc.flow === 'stale-epoch') return r;

  const judgeSc = sc.flow === 'isolation' ? { ...sc, mock: sc.otherMock } : sc;
  const pseudoRec = { verdict: r.output, status: r.status, totalMs: r.totalMs };
  const j = judgeOne(judgeSc, pseudoRec, { inputText: r.input ?? '' });
  const checks = [...j.checks, ...extra];
  const fails = checks.filter((c) => !c.pass && c.level === 'fail');
  const warns = checks.filter((c) => !c.pass && c.level === 'warn');
  const changed = (r.pass ?? false) !== (fails.length === 0);
  if (changed) {
    console.log(`↺ ${r.id}: ${r.pass ? 'pass' : 'fail'} → ${fails.length === 0 ? 'pass' : 'fail'}` +
      (fails.length ? ` (${fails.map((f) => f.id).join(',')})` : ''));
    const gone = (r.fails ?? []).filter((f) => !fails.some((n) => n.id === f.id));
    for (const g of gone) console.log(`    撤销误判: [${g.id}] ${String(g.detail).slice(0, 110)}`);
  }
  return { ...r, pass: fails.length === 0 && !r.preconditionFailed, checks, fails, warns, rejudged: true };
});

const byCat = {};
for (const r of results) {
  byCat[r.category] ??= { total: 0, pass: 0 };
  byCat[r.category].total++;
  if (r.pass) byCat[r.category].pass++;
}
const passed = results.filter((r) => r.pass).length;
const out = {
  ...d,
  rejudgedAt: new Date().toISOString(),
  rejudgeNote: '同一批真实模型输出，用修正后的 judge.mjs 重算；未重跑模型。',
  summary: {
    ...d.summary,
    total: results.length, passed, failed: results.length - passed,
    passRatePct: ((passed / results.length) * 100).toFixed(1),
    byCategory: byCat,
    warnCount: results.reduce((a, r) => a + (r.warns?.length ?? 0), 0),
  },
  results,
};
writeFileSync(dst, JSON.stringify(out, null, 2));
console.log(`\n重判后: ${passed}/${results.length} (${out.summary.passRatePct}%)`);
for (const [c, v] of Object.entries(byCat)) console.log(`  ${CATEGORY_LABEL[c]}: ${v.pass}/${v.total}`);
console.log(`写入 ${dst}`);
