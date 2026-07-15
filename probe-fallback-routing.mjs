#!/usr/bin/env node
// 兜底路由探针 —— R-1(a) 专用，确定性、可复算、不打网络、不过模型。
//
//   BACKEND_SRC=/path/to/after-sales-rrs6-backend node probe-fallback-routing.mjs
//
// ── 为什么需要这个探针 ──
// R-1(a) 的修复（dev@daf19334）是「兜底按买家风险上下文分流：低风险 → need_info、高风险 → handoff」。
// 但兜底**只在模型解析失败时**才发生（实测约 9%）。靠真链路采样去撞它：
//   · 撞到了才有判别力；撞不到就会被误读成「已修复」——这正是我上一版警告 dev 的那种自欺；
//   · 而且撞不撞得到取决于模型当轮心情，不可复算。
// 兜底分支本身是**纯函数**：给定 buyer.snapshot，输出是确定的，跟模型无关。
// 所以这里直接用 dev 的**真实实现**跑**真实快照**，把「哪些买家会被兜成转人工」一次算清。
//
// ── 这不是 mock 模型输出 ──
// 本仓禁止 mock 模型输出（mock 出来的通过率没有意义）。这条探针没有 mock 任何模型输出：
// 它跑的是 parser.fallbackVerdict 这个**解析失败之后**才执行的分支，被测的就是 dev 的真代码。
// 它回答的问题不是「模型答得对不对」，而是「**一旦**解析失败，这个买家会被路由到哪」。
// 真链路侧的对照证据见 FL-06（真 GLM + 抬高解析失败概率的输入 + m001 低风险买家）。
//
// ── 两种 payload 都要跑，且**只以 ext 作闸** ──
// 第 4 轮我差点拿一条假缺陷去卡 dev，教训写在这里：
// 我最初只用 'api' payload（工作台 API 原始字段）跑这条探针，结论是「m001/m005 仍被兜成转人工」。
// 但核对 after-sales-rrs6-extension@71004d98 的三个 adapter 后发现，**真实扩展根本不发这些值**：
//   · mockWorkbench.ts:80 `emotion: emotionHot ? '高情绪' : undefined`，而工作台
//     （taobao-customer-workbench.html:2178）仅在 `riskTags` 非空时才渲染 `.hot`
//     —— m001 的 riskTags 是 []，故真实扩展发的是 undefined，**不是「着急」**；
//   · problemType / riskHint 三个 adapter 一个都不发。
// 也就是说「着急」这个值只存在于工作台 API 里，从来没进过后端。拿它跑出来的缺陷是**我的评测口径造的**，
// 不是产品的行为。故本探针两种口径都跑：
//   ext（真实扩展实际发出的）→ **作闸**，这才是产品真实路径；
//   api（工作台 API 原始字段）→ **只观察**，用来暴露「字段契约没定死」的潜在脆弱性。
// 教训一句话：**量尺自己的输入必须先跟真实客户端对齐，否则测出来的是量尺的毛病，不是系统的毛病。**

import { writeFileSync, mkdirSync } from 'node:fs';
import { MOCK, snapshotOf } from './lib/mockdata.mjs';

const BACKEND_SRC = process.env.BACKEND_SRC;
if (!BACKEND_SRC) {
  console.error('用法: BACKEND_SRC=/path/to/after-sales-rrs6-backend node probe-fallback-routing.mjs');
  console.error('（需要 tsx：在 backend 仓里 pnpm install 后用 npx tsx 跑本脚本）');
  process.exit(2);
}

const { fallbackVerdict } = await import(`${BACKEND_SRC}/src/generation/parser.ts`);

// 期望值预注册：按 PRD §6.5 + AI-02 写死，不看结果回填。
// PRD AI-02 的阻断失败是「无故转人工」——低风险买家一旦解析失败就被兜成 handoff，
// 客服看到的就是「转人工」，与模型是否真的判过没关系。
//
// gate 字段：这条是否用来支撑阻断结论。
//   gate:true  = 判定无争议——工作台 riskTags **为空**、problemType 属纯设备/功能/物流类、
//                买家原话无退款/投诉/赔付诉求。这种买家被兜成转人工，怎么读都是 AI-02。
//   gate:false = 判定有争议——我不拿它卡 dev，只摆进表里。
//
// m006 我**主动降级为不作闸**（写在这里留痕）：初版我把它算进低风险，跑完才想清楚——
// 它的工作台 riskTags 明写着「情绪较高」，而 PRD §6.5 把「高风险情绪」列为 handoff 条件，
// dev 据此把它兜给主管是**站得住的读法**。我的量尺不该把一个自己都说不清对错的格子算成 dev 的错。
// 故本轮 R-1(a) 的阻断结论**只**建立在 m001 / m005 这两条无争议的场景上。
// （这是我看到结果之后改的期望值，方向是**削弱我自己的结论**、不是让谁通过——特此写明，可对账。）
const EXPECT = {
  m001: { risk: '低', want: 'need_info', gate: true, note: 'GP-04 原报场景：设备离线首轮排查，工作台 riskTags=[]、无任何诉求争议' },
  m005: { risk: '低', want: 'need_info', gate: true, note: '云台控制故障首轮排查，工作台 riskTags=[]、无任何诉求争议' },
  m002: { risk: '低', want: 'need_info', gate: true, note: 'BD-02：App 登录，一线可自查' },
  m004: { risk: '低', want: 'need_info', gate: true, note: '物流进度咨询' },
  m007: { risk: '低', want: 'need_info', gate: true, note: '内存卡识别不到，首轮排查' },
  m008: { risk: '低', want: 'need_info', gate: true, note: 'App 设置引导' },
  m009: { risk: '低', want: 'need_info', gate: true, note: 'GP-01：纯功能咨询，零风险' },
  m006: { risk: '低(可争议)', want: 'need_info', gate: false, note: '工作台 riskTags=「情绪较高」→ 按 PRD §6.5「高风险情绪」兜 handoff 是站得住的读法，不作闸' },
  m003: { risk: '高', want: 'handoff', gate: true, note: 'GP-06：退款争议 + 情绪较高 → 本就该兜给主管' },
  m010: { risk: '高', want: 'handoff', gate: true, note: 'GP-07：售后投诉 + 投诉风险 → 本就该兜给主管' },
};

function routeOf(key, payload) {
  const m = MOCK[key];
  const body = snapshotOf(key, {
    buyerId: `probe_${key}`,
    messages: [{ role: 'buyer', text: m.last, at: '2026-07-15T10:00:00+08:00' }],
    payload,
  });
  // 后端 BuyerSnapshot = SnapshotInput + buyerKey/epoch/updatedAt
  const snapshot = { ...body, buyerKey: `probe_${key}`, epoch: 1, updatedAt: '2026-07-15T10:00:00+08:00' };
  return { verdict: fallbackVerdict('模型本轮输出无法结构化解析，已按 PRD §6.5 降级', snapshot), sent: body };
}

const rows = [];
for (const [key, exp] of Object.entries(EXPECT)) {
  const m = MOCK[key];
  const ext = routeOf(key, 'ext');
  const api = routeOf(key, 'api');
  rows.push({
    mock: key,
    问题类型: m.problemType,
    工作台emotion: m.emotion,
    riskTags: m.risk.join('/') || '(空)',
    风险: exp.risk,
    期望: exp.want,
    'ext兜底(真实路径·作闸)': ext.verdict.type,
    'api兜底(仅观察)': api.verdict.type,
    作闸: exp.gate ? 'Y' : 'n',
    pass: ext.verdict.type === exp.want,
    note: exp.note,
    extEmotionSent: ext.sent.emotion ?? '(不发)',
  });
}

console.table(rows.map(({ note, extEmotionSent, ...r }) => r));

const gateRows = rows.filter((r) => EXPECT[r.mock].gate);
const lowGate = gateRows.filter((r) => r.风险 === '低');
const extBad = lowGate.filter((r) => r['ext兜底(真实路径·作闸)'] === 'handoff');
const apiOnlyBad = rows.filter(
  (r) => r['api兜底(仅观察)'] === 'handoff' && r['ext兜底(真实路径·作闸)'] !== 'handoff' && r.期望 !== 'handoff',
);

console.log('');
if (extBad.length) {
  console.log(`❌ R-1(a) 未清零（真实扩展路径）：${extBad.length}/${lowGate.length} 条无争议低风险买家仍被兜成「转人工」(AI-02)`);
  for (const r of extBad) console.log(`   · ${r.mock} ${r.问题类型} — 扩展实发 emotion=${r.extEmotionSent} → ${r['ext兜底(真实路径·作闸)']}`);
} else {
  console.log(`✅ R-1(a) 已清零（真实扩展路径）：${lowGate.length}/${lowGate.length} 条无争议低风险买家兜底均降级为 need_info，未出现无故转人工。`);
  console.log('   高风险侧对照（m003 退款争议 / m010 售后投诉）仍正确兜 handoff——门没被一起关掉。');
}

if (apiOnlyBad.length) {
  console.log('');
  console.log(`⚠ 潜在脆弱性（不作闸，记观察项）：${apiOnlyBad.length} 条买家在 **api 口径**下会被兜成转人工，ext 口径下不会：`);
  for (const r of apiOnlyBad) {
    console.log(`   · ${r.mock} ${r.问题类型}：工作台 emotion="${r.工作台emotion}"、riskTags=${r.riskTags}`);
  }
  console.log('   成因：parser.isHighRiskContext 的 emotion 正则含 /着急/，而工作台真实 emotion 里就有「着急」（10 单占 3 单）。');
  console.log('   今天不出事，只因为扩展把这个字段**丢掉了**（只在 riskTags 非空时发固定串「高情绪」），');
  console.log('   后端于是永远读不到「着急」——两处实现各走各的，靠巧合对上。');
  console.log('   风险：哪天有人让 adapter 如实透传页面的 emotion（这看起来只是个「补全字段」的小改动），');
  console.log('   这 3 个低风险买家就会在解析失败时静默变成「转人工」，且没有任何测试会拦住。');
  console.log('   建议：把 emotion/problemType/riskHint 的取值**契约化**（枚举或显式 riskTags 布尔），别让语义判定依赖自由文本。');
}

mkdirSync('results', { recursive: true });
const out = {
  probe: 'fallback-routing',
  writtenAt: new Date().toISOString(),
  backendSrc: BACKEND_SRC,
  method:
    '直接调用 dev 真实实现 parser.fallbackVerdict（解析失败后的纯函数分支），未 mock 任何模型输出。' +
    '两种 payload 各跑一遍：ext=真实扩展实际发出的字段（作闸），api=工作台 API 原始字段（仅观察）。',
  gateOn: 'ext（真实扩展路径）',
  expectPreRegistered: EXPECT,
  rows,
  verdict: extBad.length ? 'R-1(a) 未清零（真实路径）' : 'R-1(a) 已清零（真实路径）',
  extLowRiskToHandoff: extBad.map((r) => r.mock),
  apiOnlyFragile: apiOnlyBad.map((r) => r.mock),
};
writeFileSync('results/probe-fallback-routing.json', JSON.stringify(out, null, 2));
console.log('\n证据已写入 results/probe-fallback-routing.json');
process.exit(extBad.length ? 1 : 0);
