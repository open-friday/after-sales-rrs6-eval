#!/usr/bin/env node
// rrs6 AI 效果评测跑测器
//
//   API_BASE=http://140.143.131.216:8797 API_TOKEN=<token> node run-eval.mjs
//   node run-eval.mjs --only GP-01,AD-01      只跑指定场景
//   node run-eval.mjs --no-stability          跳过重复稳定性采样
//   node run-eval.mjs --out results/run-x.json
//
// 每条场景落盘：输入(prompt 侧的全部喂入)、后端原始 GenerationRecord、逐项判定、耗时。
// 没有证据的分数等于没测——所以这里落的是原始输出，不是结论。

import { writeFileSync, mkdirSync } from 'node:fs';
import { SCENARIOS, CATEGORY_LABEL, categoryCounts } from './scenarios.mjs';
import { snapshotOf, MOCK } from './lib/mockdata.mjs';
import { judgeOne, judgeStability, allText } from './judge.mjs';
import * as api from './lib/api.mjs';

const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const only = argOf('--only')?.split(',').map((s) => s.trim());
const noStability = args.includes('--no-stability');
const RUN = argOf('--run-id', `qa${Date.now().toString(36)}`);
const OUT = argOf('--out', `results/run-${RUN}.json`);

const log = (m) => console.log(`[eval ${new Date().toISOString().slice(11, 19)}] ${m}`);

function bid(sc, suffix = '') {
  return `evl_${RUN}_${sc.id.toLowerCase().replace('-', '')}${suffix}`;
}

async function snap(sc, buyerId, messages, opts = {}) {
  const body = snapshotOf(sc.mock, {
    buyerId, messages,
    dropSku: opts.dropSku ?? sc.dropSku,
    anonymous: opts.anonymous ?? sc.anonymous,
  });
  const r = await api.post('/api/session-snapshots', body);
  return { buyerKey: r.json.buyerKey, epoch: r.json.epoch, sent: body };
}

function inputTextOf(sent, extra = '') {
  const msgs = (sent.recentMessages ?? []).map((m) => m.text).join('\n');
  const sku = sent.sku ? `${sent.sku.name} ${sent.sku.meta ?? ''} ${sent.sku.order ?? ''}` : '';
  return [msgs, sku, extra].join('\n');
}

// ───────────────────────── flows ─────────────────────────

async function flowSingle(sc) {
  const msgs = sc.messages ?? [];
  const s = await snap(sc, bid(sc), msgs);
  const { rec, clientMs } = await api.generate({ buyerKey: s.buyerKey, epoch: s.epoch });
  return { rec, clientMs, inputText: inputTextOf(s.sent), trace: { snapshot: s.sent } };
}

async function flowTurns(sc) {
  const all = [];
  let last = null, sent = null;
  for (let i = 0; i < sc.turns.length; i++) {
    const s = await snap(sc, bid(sc), sc.turns[i]);
    sent = s.sent;
    const { rec, clientMs } = await api.generate({ buyerKey: s.buyerKey, epoch: s.epoch });
    all.push({ turn: i + 1, type: rec?.verdict?.type, draft: rec?.verdict?.draft ?? rec?.verdict?.acceptance });
    last = { rec, clientMs };
  }
  // 判定只看最后一轮（末句歧义那轮），前几轮原样留证
  return { ...last, inputText: inputTextOf(sent), trace: { turns: all } };
}

async function flowConclusion(sc) {
  // 1) 先跑出一个 handoff
  const s = await snap(sc, bid(sc), sc.messages ?? [{ role: 'buyer', text: MOCK[sc.mock].last, at: '2026-07-15T10:00:00+08:00' }]);
  const first = await api.generate({ buyerKey: s.buyerKey, epoch: s.epoch });
  if (first.rec?.verdict?.type !== 'handoff') {
    return {
      rec: first.rec, clientMs: first.clientMs, inputText: inputTextOf(s.sent),
      trace: { note: `前置未产生 handoff（实际 ${first.rec?.verdict?.type}），无法验证结论回填` },
      preconditionFailed: true,
    };
  }
  // 2) 取 handoffId
  const hist = await api.get(`/api/history?buyerKey=${encodeURIComponent(s.buyerKey)}`);
  const h = (hist.handoffs ?? []).at(-1);
  if (!h) throw new Error('handoff 记录未落库');
  // 3) 确认交接（AC-16）
  await api.post(`/api/handoffs/${h.id}/ack`, {});
  // 4) 回填人工结论 → 触发最终回复
  const sub = await api.post(`/api/handoffs/${h.id}/conclusions`, { text: sc.conclusionText });
  const id = sub.json?.generationId;
  const t0 = Date.now();
  let rec = null;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const g = await api.get(`/api/generations/${id}?buyerKey=${encodeURIComponent(s.buyerKey)}`);
    rec = g?.generation;
    if (rec && ['succeeded', 'failed', 'timeout', 'unavailable'].includes(rec.status)) break;
  }
  return {
    rec, clientMs: Date.now() - t0,
    inputText: inputTextOf(s.sent, sc.conclusionText),
    trace: { handoffId: h.id, acked: true, conclusionText: sc.conclusionText, firstVerdict: first.rec?.verdict },
  };
}

async function flowIsolation(sc) {
  // A：本场景 mock（m001），带补充文本 + 图片证据
  const a = await snap(sc, bid(sc, '_a'), sc.messages ?? [{ role: 'buyer', text: MOCK[sc.mock].last, at: '2026-07-15T10:00:00+08:00' }]);
  await api.post('/api/supplement', { buyerKey: a.buyerKey, epoch: a.epoch, text: sc.supplementText });
  await api.post('/api/supplement', { buyerKey: a.buyerKey, epoch: a.epoch, pastedImage: { fileName: sc.supplementImage } });
  const genA1 = await api.generate({ buyerKey: a.buyerKey, epoch: a.epoch });

  // B：另一个 mock 买家（m003），无任何补充
  const scB = { ...sc, mock: sc.otherMock };
  const bSent = snapshotOf(sc.otherMock, {
    buyerId: bid(sc, '_b'),
    messages: [{ role: 'buyer', text: MOCK[sc.otherMock].last, at: '2026-07-15T10:05:00+08:00' }],
  });
  const bResp = await api.post('/api/session-snapshots', bSent);
  const genB = await api.generate({ buyerKey: bResp.json.buyerKey, epoch: bResp.json.epoch });

  // 切回 A：A 自己的补充与图片必须还在（AC-09 后半）
  const genA2 = await api.generate({ buyerKey: a.buyerKey, epoch: a.epoch, isRegeneration: true });
  const aBack = allText(genA2.rec?.verdict);

  return {
    rec: genB.rec, clientMs: genB.clientMs,
    inputText: inputTextOf(bSent),
    // 判定对象是 B 的输出；串买家检查跑的是「B 输出里有没有 A 的东西」
    judgeAgainstMock: sc.otherMock,
    extraChecks: [
      {
        id: 'iso_b_no_a_supplement',
        pass: !allText(genB.rec?.verdict).includes(sc.supplementImage) &&
              !allText(genB.rec?.verdict).includes('指示灯红色常亮') &&
              !allText(genB.rec?.verdict).includes('5G 双频'),
        level: 'fail',
        detail: 'B 的输出不得含 A 的补充文本或图片名 ' + sc.supplementImage,
      },
      {
        id: 'iso_a_context_kept',
        pass: Boolean(genA2.rec?.verdict),
        level: 'fail',
        detail: `切回 A 后仍能基于 A 自己的上下文生成（type=${genA2.rec?.verdict?.type}）`,
      },
    ],
    trace: {
      A: { buyerKey: a.buyerKey, verdict: genA1.rec?.verdict, supplement: sc.supplementText, image: sc.supplementImage },
      B: { buyerKey: bResp.json.buyerKey, verdict: genB.rec?.verdict },
      A_after: { verdict: genA2.rec?.verdict, mentionsOwnImage: aBack.includes(sc.supplementImage) },
    },
  };
}

async function flowStaleEpoch(sc) {
  const s1 = await snap(sc, bid(sc), sc.messages);
  // 买家侧新增一条消息 → epoch bump（等价于客服切走/对话推进）
  const s2 = await snap(sc, bid(sc), [...sc.messages, { role: 'buyer', text: '算了，你们别管了。', at: '2026-07-15T10:10:00+08:00' }]);
  if (s2.epoch === s1.epoch) throw new Error(`epoch 未 bump（${s1.epoch} -> ${s2.epoch}），场景前提不成立`);
  // 用旧 epoch 提交
  const r = await api.post('/api/generations', { buyerKey: s1.buyerKey, epoch: s1.epoch, wait: true }, { allowFail: true });
  return {
    rec: null, clientMs: 0, inputText: inputTextOf(s1.sent),
    extraChecks: [{
      id: 'stale_epoch_rejected',
      pass: !r.ok,
      level: 'fail',
      detail: `旧 epoch=${s1.epoch}（当前 ${s2.epoch}）提交 → HTTP ${r.status} ${r.text.slice(0, 120)}`,
    }],
    trace: { epochOld: s1.epoch, epochNew: s2.epoch, submitStatus: r.status, submitBody: r.text.slice(0, 300) },
    skipVerdictChecks: true,
  };
}

const FLOWS = {
  single: flowSingle, turns: flowTurns, conclusion: flowConclusion,
  isolation: flowIsolation, 'stale-epoch': flowStaleEpoch,
};

// ───────────────────────── runner ─────────────────────────

async function runScenario(sc) {
  const flow = FLOWS[sc.flow ?? 'single'];
  const t0 = Date.now();
  const out = await flow(sc);
  const judgeSc = out.judgeAgainstMock ? { ...sc, mock: out.judgeAgainstMock } : sc;
  let verdictJudge = { checks: [], pass: true, fails: [], warns: [] };
  if (!out.skipVerdictChecks) verdictJudge = judgeOne(judgeSc, out.rec, { inputText: out.inputText });
  const checks = [...verdictJudge.checks, ...(out.extraChecks ?? [])];
  const fails = checks.filter((c) => !c.pass && c.level === 'fail');
  const warns = checks.filter((c) => !c.pass && c.level === 'warn');
  return {
    id: sc.id, category: sc.category, title: sc.title, covers: sc.covers,
    rationale: sc.rationale,
    pass: fails.length === 0 && !out.preconditionFailed,
    preconditionFailed: out.preconditionFailed ?? false,
    verdictType: out.rec?.verdict?.type ?? null,
    status: out.rec?.status ?? null,
    totalMs: out.rec?.totalMs ?? null,
    wallMs: Date.now() - t0,
    checks, fails, warns,
    input: out.inputText,
    output: out.rec?.verdict ?? null,
    processSteps: out.rec?.processSteps ?? null,
    trace: out.trace ?? null,
  };
}

async function runStability(sc) {
  const types = [], samples = [];
  for (let i = 0; i < sc.stability; i++) {
    const s = await snap(sc, bid(sc, `_st${i}`), sc.messages ?? []);
    const { rec } = await api.generate({ buyerKey: s.buyerKey, epoch: s.epoch });
    types.push(rec?.verdict?.type ?? rec?.status ?? 'none');
    samples.push({ i, type: rec?.verdict?.type, ms: rec?.totalMs, draft: (rec?.verdict?.draft ?? rec?.verdict?.acceptance ?? '').slice(0, 160) });
    log(`  ${sc.id} 稳定性 ${i + 1}/${sc.stability} → ${types.at(-1)} (${rec?.totalMs}ms)`);
  }
  return { id: sc.id, title: sc.title, ...judgeStability(types), types, samples };
}

function buildReport(runId, health, results, stability) {
  const byCat = {};
  for (const r of results) {
    byCat[r.category] ??= { total: 0, pass: 0 };
    byCat[r.category].total++;
    if (r.pass) byCat[r.category].pass++;
  }
  const passed = results.filter((r) => r.pass).length;
  const durations = results.map((r) => r.totalMs).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  const p = (q) => (durations.length ? durations[Math.max(0, Math.ceil(q * durations.length) - 1)] : null);
  return {
    runId,
    writtenAt: new Date().toISOString(),
    target: api.API_BASE,
    health,
    summary: {
      total: results.length, passed, failed: results.length - passed,
      passRatePct: results.length ? ((passed / results.length) * 100).toFixed(1) : '0',
      byCategory: byCat,
      warnCount: results.reduce((a, r) => a + (r.warns?.length ?? 0), 0),
      latency: { n: durations.length, p50: p(0.5), p95: p(0.95), max: durations.at(-1) ?? null },
    },
    stability,
    results,
  };
}

async function main() {
  mkdirSync('results', { recursive: true });
  const h = await api.health();
  log(`后端 ${api.API_BASE} → ${JSON.stringify(h)}`);

  const list = SCENARIOS.filter((s) => !s.expect?.localOnly).filter((s) => !only || only.includes(s.id));
  // 硬闸：只要选中的场景里有一条要过模型，就必须是真链路。
  // FL-02(stale epoch) 在调用模型之前就被 submit 拒绝，故可在无凭据实例上单独跑通管路。
  const needsModel = list.some((s) => s.flow !== 'stale-epoch');
  if (needsModel && !h.modelConfigured) {
    throw new Error('modelConfigured=false —— 拒绝在非真链路上跑评测（mock 出来的通过率没有意义）');
  }
  log(`场景 ${list.length} 条  分类=${JSON.stringify(categoryCounts())}  run=${RUN}`);

  const results = [];
  const stability = [];
  // 每条跑完就落盘：2026-07-15 首跑在稳定性阶段被 ECONNRESET 打断，
  // 结果全在内存里 → 26 条真实样本全丢。证据必须边跑边写。
  const flush = () => writeFileSync(OUT, JSON.stringify(buildReport(RUN, h, results, stability), null, 2));

  for (const sc of list) {
    try {
      const r = await runScenario(sc);
      results.push(r);
      log(`${r.pass ? '✅' : '❌'} ${sc.id} [${CATEGORY_LABEL[sc.category]}] → ${r.verdictType ?? r.status} ${r.totalMs ?? r.wallMs}ms ${r.fails.map((f) => f.id).join(',')}`);
    } catch (e) {
      log(`💥 ${sc.id} 跑挂: ${e.message}`);
      results.push({ id: sc.id, category: sc.category, title: sc.title, pass: false, error: e.message, checks: [], fails: [{ id: 'harness_error', detail: e.message }], warns: [] });
    }
    flush();
  }

  if (!noStability) {
    for (const sc of list.filter((s) => s.stability)) {
      log(`稳定性采样 ${sc.id} × ${sc.stability}`);
      try {
        stability.push(await runStability(sc));
      } catch (e) {
        log(`💥 ${sc.id} 稳定性跑挂: ${e.message}`);
        stability.push({ id: sc.id, title: sc.title, error: e.message, n: 0, ratio: 0, counts: {}, types: [], samples: [] });
      }
      flush();
    }
  }

  flush();
  const report = buildReport(RUN, h, results, stability);
  const passed = report.summary.passed;
  log(`—— 通过 ${passed}/${results.length} (${report.summary.passRatePct}%) · 结果写入 ${OUT}`);
  for (const [c, v] of Object.entries(report.summary.byCategory)) log(`   ${CATEGORY_LABEL[c]}: ${v.pass}/${v.total}`);
  for (const s of stability) log(`   稳定性 ${s.id}: ${s.topType} 一致率=${(s.ratio * 100).toFixed(0)}% ${s.riskFlip ? '⚠️跨风险翻转' : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
