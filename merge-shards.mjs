#!/usr/bin/env node
// 把分片跑的多个 results/run-*.json 合成一份，供 summarize.mjs 消费。
//
// 为什么要分片：后端「每次 prompt 一次 ACP session」但只有一个 stdio 子进程，
// 并发请求会在子进程里排队 → 单请求墙钟被拉长 → 撞 45s 硬超时 → 被判定器记成路由失败。
// 那是**跑法造成的假缺陷**（第 4 轮、第 6 轮各犯过一次）。
// 正解：起 N 个独立后端实例（各自独立 ACP 子进程 + DATA_DIR），每个实例 --concurrency 1 跑一个分片，
// 真并行但每实例内部串行 → 不丢吞吐，也不自造超时。本脚本负责把分片结果合回一份。
//
//   node merge-shards.mjs results/run-r6-ext-a.json results/run-r6-ext-b.json results/run-r6-ext-c.json --out results/run-r6-ext.json

import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const outI = args.indexOf('--out');
const out = outI >= 0 ? args[outI + 1] : 'results/merged.json';
const files = args.filter((a, i) => a.endsWith('.json') && i !== outI + 1);

const parts = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
const results = parts.flatMap((p) => p.results ?? []);
const stability = parts.flatMap((p) => p.stability ?? []);

const lat = results.map((r) => r.totalMs).filter((x) => typeof x === 'number' && x > 0).sort((a, b) => a - b);
const pct = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))] : null);

const byCategory = {};
for (const r of results) {
  byCategory[r.category] ??= { pass: 0, total: 0 };
  byCategory[r.category].total++;
  if (r.pass) byCategory[r.category].pass++;
}

const passed = results.filter((r) => r.pass).length;
const merged = {
  runId: parts.map((p) => p.runId).join('+'),
  target: parts.map((p) => p.target).join(' | '),
  startedAt: parts[0]?.startedAt,
  meta: { ...(parts[0]?.meta ?? {}), shards: files, shardMeta: parts.map((p) => ({ runId: p.runId, target: p.target })) },
  health: parts.map((p) => p.health),
  summary: {
    total: results.length,
    passed,
    passRatePct: results.length ? Number(((passed / results.length) * 100).toFixed(1)) : 0,
    warnCount: results.reduce((n, r) => n + (r.warns?.length ?? 0), 0),
    byCategory,
    latency: { n: lat.length, p50: pct(50), p95: pct(95), max: lat.at(-1) ?? null },
  },
  stability,
  results,
};

writeFileSync(out, JSON.stringify(merged, null, 2));
console.log(`合并 ${files.length} 个分片 → ${out} · 场景 ${results.length} 条 · 通过 ${passed}`);
