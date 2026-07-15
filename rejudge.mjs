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
import { HOLDOUT } from './scenarios-holdout.mjs';
import { judgeOne, judgeStability } from './judge.mjs';

const src = process.argv[2] ?? 'results/run-r2.json';
const dst = process.argv[3] ?? src.replace(/\.json$/, '-rejudged.json');
const d = JSON.parse(readFileSync(src, 'utf8'));
const byId = new Map([...SCENARIOS, ...HOLDOUT].map((s) => [s.id, s]));

/** 重判一条采样（老格式的单条结果也走这里） */
function rejudgeSample(sc, s) {
  // stale-epoch / isolation 这类靠 extraChecks 判定的，原样保留
  const extra = (s.checks ?? []).filter((c) => c.id.startsWith('iso_') || c.id.startsWith('stale_') || c.id.startsWith('r2_') || c.id.startsWith('no_unbacked_final_archived'));
  const judgeSc = sc.flow === 'isolation' ? { ...sc, mock: sc.otherMock } : sc;
  const pseudoRec = { verdict: s.output, status: s.status, totalMs: s.totalMs, processSteps: s.processSteps };
  const j = judgeOne(judgeSc, pseudoRec, { inputText: s.input ?? '', hasConclusion: Boolean(sc.conclusionText) });
  const checks = [...j.checks, ...extra];
  const fails = checks.filter((c) => !c.pass && c.level === 'fail');
  const warns = checks.filter((c) => !c.pass && c.level === 'warn');
  const pass = fails.length === 0 && !s.preconditionFailed;
  if ((s.pass ?? false) !== pass) {
    console.log(`↺ ${sc.id}${s.sample !== undefined ? ` s${s.sample}` : ''}: ${s.pass ? 'pass' : 'fail'} → ${pass ? 'pass' : 'fail'}` +
      (fails.length ? ` (${fails.map((f) => f.id).join(',')})` : ''));
    for (const g of (s.fails ?? []).filter((f) => !fails.some((n) => n.id === f.id))) {
      console.log(`    撤销误判: [${g.id}] ${String(g.detail).slice(0, 110)}`);
    }
  }
  return { ...s, pass, checks, fails, warns, rejudged: true };
}

const results = d.results.map((r) => {
  const sc = byId.get(r.id);
  if (!sc || r.error) return r;
  if (sc.flow === 'stale-epoch') return r;

  // 新格式（第 3 轮起）：每条场景 N 次采样，逐次重判
  if (Array.isArray(r.samples)) {
    const samples = r.samples.map((s) => (s.error ? s : rejudgeSample(sc, s)));
    const passN = samples.filter((s) => s.pass).length;
    const types = samples.map((s) => s.verdictType ?? s.status ?? 'none');
    return {
      ...r, samples, passN, pass: passN === samples.length,
      consistency: judgeStability(types), rejudged: true,
    };
  }
  // 老格式（run-r2.json）：单条结果
  return rejudgeSample(sc, r);
});

const byCat = {};
for (const r of results) {
  byCat[r.category] ??= { total: 0, pass: 0 };
  byCat[r.category].total++;
  if (r.pass) byCat[r.category].pass++;
}
const passed = results.filter((r) => r.pass).length;
const allSamples = results.flatMap((r) => r.samples ?? [r]);
const samplesPassed = allSamples.filter((s) => s.pass).length;
const out = {
  ...d,
  rejudgedAt: new Date().toISOString(),
  rejudgeNote: '同一批真实模型输出，用修正后的 judge.mjs 重算；未重跑模型。',
  summary: {
    ...d.summary,
    scenarios: results.length, scenariosPassed: passed, scenariosFailed: results.length - passed,
    scenarioPassRatePct: ((passed / results.length) * 100).toFixed(1),
    samples: allSamples.length, samplesPassed,
    samplePassRatePct: allSamples.length ? ((samplesPassed / allSamples.length) * 100).toFixed(1) : '0',
    byCategory: byCat,
    warnCount: allSamples.reduce((a, s) => a + (s.warns?.length ?? 0), 0),
  },
  results,
};
writeFileSync(dst, JSON.stringify(out, null, 2));
console.log(`\n重判后: 场景全过 ${passed}/${results.length} · 样本 ${samplesPassed}/${allSamples.length} (${out.summary.samplePassRatePct}%)`);
for (const [c, v] of Object.entries(byCat)) console.log(`  ${CATEGORY_LABEL[c]}: ${v.pass}/${v.total}`);
console.log(`写入 ${dst}`);
