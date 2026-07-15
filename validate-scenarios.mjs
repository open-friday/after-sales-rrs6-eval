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

// 留出集不变量（第 3 轮起，第 4 轮加严）：
// 留出集存在的意义是「dev 修 prompt 时没见过这些说法」，用来区分「口径立住了」与「答案被特判」。
//
// 必须**两个方向同时存在**（配对探针）——这是第 3/4 两轮真金白银换来的：
//   · 只测「该转人工的要转」→ 奖励一路收紧 → dev 把口径写宽，低风险咨询被卷进 handoff；
//   · 只测「不该转的别转」  → 奖励一路放宽 → 正是第 4 轮 R-4 的来路：dev 为修 BD-02 翻转
//     给 handoff 加了 PRD 没有的门槛，把投诉/退款争议一起关掉了（GP-07 0/5）。
// 单向的量尺会把 dev 推向另一头的坑，两头都钉住才测得到口径本身。
const gateHoldout = HOLDOUT.filter((s) => !s.advisory);
if (gateHoldout.length) {
  const mustHandoff = gateHoldout.filter((s) => (s.expect?.allowed ?? []).includes('handoff') && !(s.expect?.allowed ?? []).includes('direct_reply'));
  const mustNotHandoff = gateHoldout.filter((s) => (s.expect?.allowed ?? []).length && !(s.expect?.allowed ?? []).includes('handoff'));
  if (!mustHandoff.length) errs.push('留出集缺「必须转人工」方向的探针——只测「别乱转人工」会奖励过度纠偏（矫枉过正测不出来）');
  if (!mustNotHandoff.length) errs.push('留出集缺「不得转人工」方向的探针——只测「该转的要转」会奖励一路收紧（R-4 就是这么来的）');
}

// 每轮必须有**未烧掉**的新留出场景：已随报告公开的留出集只能证明没回退，不能再证明泛化。
const fresh = HOLDOUT.filter((s) => !s.burned);
if (HOLDOUT.length && !fresh.length) {
  errs.push('留出集全部已烧掉（burned）——本轮没有 dev 没见过的说法，泛化结论无从谈起，必须新增一组');
}

if (errs.length) {
  console.error('❌ 评测集不变量校验失败:');
  for (const e of errs) console.error('  - ' + e);
  process.exit(1);
}
const idsOf = (l) => l.map((s) => s.id).join(',') || '无';
console.log(`✅ 评测集 ${SCENARIOS.length} 条 · ${Object.entries(counts).map(([k, v]) => `${CATEGORY_LABEL[k]}=${v}`).join(' ')}`);
console.log(`✅ 留出集 ${HOLDOUT.length} 条（新 ${fresh.length} / 已烧 ${HOLDOUT.length - fresh.length}）`);
console.log(`   · 要求转人工: ${idsOf(gateHoldout.filter((s) => (s.expect?.allowed ?? []).includes('handoff') && !(s.expect?.allowed ?? []).includes('direct_reply')))}`);
console.log(`   · 不得转人工: ${idsOf(gateHoldout.filter((s) => (s.expect?.allowed ?? []).length && !(s.expect?.allowed ?? []).includes('handoff')))}`);
console.log(`   · 口径观察(不作闸): ${idsOf(HOLDOUT.filter((s) => s.advisory))}`);
console.log(`✅ 覆盖 PRD §7.4: ${[...covered].filter((c) => c.startsWith('AI-')).sort().join(' ')}`);
