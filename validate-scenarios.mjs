#!/usr/bin/env node
// 评测集不变量 —— CI 跑，防止后人把场景删薄或把标准改松。
// 不打网络，纯静态校验。

import { SCENARIOS, CATEGORY_LABEL, categoryCounts } from './scenarios.mjs';
import { HOLDOUT } from './scenarios-holdout.mjs';

const errs = [];
const MIN_TOTAL = 20;      // 本轮任务要求：>= 20 个场景
const MIN_PER_CAT = 5;     // 四类各 >= 5

const counts = categoryCounts();
if (SCENARIOS.length < MIN_TOTAL) errs.push(`场景总数 ${SCENARIOS.length} < ${MIN_TOTAL}`);
for (const cat of Object.keys(CATEGORY_LABEL)) {
  const n = counts[cat] ?? 0;
  if (n < MIN_PER_CAT) errs.push(`${CATEGORY_LABEL[cat]} 只有 ${n} 条 < ${MIN_PER_CAT}`);
}

const ALL = [...SCENARIOS, ...HOLDOUT];
const ids = new Set();
for (const s of ALL) {
  if (ids.has(s.id)) errs.push(`${s.id} 重复`);
  ids.add(s.id);
  if (!s.title) errs.push(`${s.id} 缺 title`);
  if (!s.rationale) errs.push(`${s.id} 缺 rationale（判定依据）——没有依据的场景不算场景`);
  if (!s.covers?.length && !s.expect?.localOnly) errs.push(`${s.id} 缺 covers（对应哪条 AC/AI）`);
  if (!CATEGORY_LABEL[s.category]) errs.push(`${s.id} 分类非法: ${s.category}`);
  if (!s.expect) errs.push(`${s.id} 缺 expect`);
}

// 必须覆盖的 PRD AI 效果验收项。
// AI-06（风格评审·抽样 >=10 条不同场景）不单列场景：judge.mjs 的风格检查对全部 28 条都跑，
// 覆盖面严于「抽样 10 条」，故这里只校验 28 >= 10。
const covered = new Set(SCENARIOS.flatMap((s) => s.covers ?? []));
for (const ai of ['AI-01', 'AI-02', 'AI-03', 'AI-04', 'AI-05', 'AI-07']) {
  if (!covered.has(ai)) errs.push(`PRD §7.4 ${ai} 无场景覆盖`);
}
if (SCENARIOS.filter((s) => !s.expect?.localOnly).length < 10) {
  errs.push('AI-06 要求风格评审至少覆盖 10 条不同场景，当前打模型的场景不足 10 条');
}

// 留出集不变量（第 3 轮起）：
// 留出集存在的意义是「dev 修 prompt 时没见过这些说法」，用来区分「口径立住了」与「答案被特判」。
// 它必须至少有一条**反向探针**（期望 handoff 的那种）——否则一组全是「别转人工」的留出场景，
// 会奖励「一律不转人工」这种过度纠偏，测不出矫枉过正。
if (HOLDOUT.length) {
  const reverse = HOLDOUT.filter((s) => (s.expect?.allowed ?? []).includes('handoff') && !(s.expect?.allowed ?? []).includes('direct_reply'));
  if (!reverse.length) errs.push('留出集缺反向探针（期望 handoff 且不允许 direct_reply 的场景）——只测「别乱转人工」会奖励过度纠偏');
}

if (errs.length) {
  console.error('❌ 评测集不变量校验失败:');
  for (const e of errs) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✅ 评测集 ${SCENARIOS.length} 条 · ${Object.entries(counts).map(([k, v]) => `${CATEGORY_LABEL[k]}=${v}`).join(' ')}`);
console.log(`✅ 留出集 ${HOLDOUT.length} 条 · 反向探针 ${HOLDOUT.filter((s) => (s.expect?.allowed ?? []).includes('handoff') && !(s.expect?.allowed ?? []).includes('direct_reply')).map((s) => s.id).join(',') || '无'}`);
console.log(`✅ 覆盖 PRD §7.4: ${[...covered].filter((c) => c.startsWith('AI-')).sort().join(' ')}`);
