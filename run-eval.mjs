#!/usr/bin/env node
// rrs6 AI 效果评测跑测器
//
//   API_BASE=http://140.143.131.216:8797 API_TOKEN=<token> node run-eval.mjs
//   node run-eval.mjs --samples 5             每条场景独立重跑 5 次，逐次判定（第 3 轮起的默认做法）
//   node run-eval.mjs --holdout               把留出集(scenarios-holdout.mjs)一起跑
//   node run-eval.mjs --only GP-01,AD-01      只跑指定场景
//   node run-eval.mjs --concurrency 3         并发跑场景（不同场景 buyerKey 互不相干）
//   node run-eval.mjs --out results/run-x.json
//
// 每次采样都落盘：输入(prompt 侧的全部喂入)、后端原始 GenerationRecord、逐项判定、耗时。
// 没有证据的分数等于没测——所以这里落的是原始输出，不是结论。
//
// 为什么第 3 轮起每条都跑 >= 5 次（--samples 5）：
//   第 2 版每条只跑 1 次（另加 4 条专门采样），结果「亲」第 1 轮出现、第 2 轮同输入没复现。
//   单跑一轮会**系统性低估**不稳定类问题；而模型不稳定本身就是缺陷。
//   所以复测一律每条 >= 5 次采样，场景判定按「5 次全过才算过」，同时给样本级通过率。

import { writeFileSync, mkdirSync } from 'node:fs';
import { SCENARIOS, CATEGORY_LABEL, categoryCounts } from './scenarios.mjs';
import { HOLDOUT } from './scenarios-holdout.mjs';
import { snapshotOf, MOCK } from './lib/mockdata.mjs';
import { judgeOne, judgeStability, allText, detectFallback } from './judge.mjs';
import * as api from './lib/api.mjs';

const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const only = argOf('--only')?.split(',').map((s) => s.trim());
const SAMPLES = Number(argOf('--samples', '1'));
const CONCURRENCY = Number(argOf('--concurrency', '1'));
const withHoldout = args.includes('--holdout');
// 'ext' = 按真实扩展实际发出的字段喂（见 lib/mockdata.mjs 的 snapshotOf 注释）。放行结论以 ext 为准。
const PAYLOAD = argOf('--payload', 'api');
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
    payload: PAYLOAD,
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
// 每个 flow 收 (sc, tag)：tag 让同一场景的第 i 次采样用**独立 buyerId**，
// 样本间不共享任何后端状态——否则测的是「第 2 次会不会受第 1 次影响」，不是同输入稳定性。

async function flowSingle(sc, tag) {
  const msgs = sc.messages ?? [];
  const s = await snap(sc, bid(sc, tag), msgs);
  const { rec, clientMs } = await api.generate({ buyerKey: s.buyerKey, epoch: s.epoch });
  return { rec, clientMs, inputText: inputTextOf(s.sent), trace: { snapshot: s.sent } };
}

async function flowTurns(sc, tag) {
  const all = [];
  let last = null, sent = null;
  for (let i = 0; i < sc.turns.length; i++) {
    const s = await snap(sc, bid(sc, tag), sc.turns[i]);
    sent = s.sent;
    const { rec, clientMs } = await api.generate({ buyerKey: s.buyerKey, epoch: s.epoch });
    all.push({ turn: i + 1, type: rec?.verdict?.type, draft: rec?.verdict?.draft ?? rec?.verdict?.acceptance });
    last = { rec, clientMs, buyerKey: s.buyerKey };
  }
  // 判定只看最后一轮（末句歧义那轮），前几轮原样留证
  return { ...last, inputText: inputTextOf(sent), trace: { turns: all } };
}

async function flowConclusion(sc, tag) {
  // 1) 先跑出一个 handoff
  const s = await snap(sc, bid(sc, tag), sc.messages ?? [{ role: 'buyer', text: MOCK[sc.mock].last, at: '2026-07-15T10:00:00+08:00' }]);
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
  // 落库核对（AC-31 回复版本可回看/可审计）
  const after = await api.get(`/api/history?buyerKey=${encodeURIComponent(s.buyerKey)}`);
  const finals = (after.replies ?? []).filter((r) => r.isFinal);
  return {
    rec, clientMs: Date.now() - t0,
    inputText: inputTextOf(s.sent, sc.conclusionText),
    archived: { replyCount: (after.replies ?? []).length, finalCount: finals.length, finalFrom: finals.map((f) => f.finalReplyFromConclusion) },
    trace: { handoffId: h.id, acked: true, conclusionText: sc.conclusionText, firstVerdict: first.rec?.verdict },
  };
}

/**
 * BD-07 专用（第 3 轮新增）：多轮 + 前轮已 handoff 待人工结论 + **本轮不回填结论**。
 * 第 2 版 R-2 就是在这条路径上抓到的：模型自造 conclusion → parser 升格 final_reply
 * → 落库 isFinal=true。dev 声称已在 parser 加 ctx.hasConclusion 门。
 * 复测不能只看 verdict.type——还要回查 /api/history 确认**库里**没凭空多出 isFinal 回复，
 * 因为 R-2 的实际危害是「历史里出现一条『最终回复』」（AC-31 可审计）。
 */
async function flowTurnsNoConclusion(sc, tag) {
  const out = await flowTurns(sc, tag);
  let archived = null;
  try {
    const hist = await api.get(`/api/history?buyerKey=${encodeURIComponent(out.buyerKey)}`);
    const finals = (hist.replies ?? []).filter((r) => r.isFinal);
    archived = {
      replyCount: (hist.replies ?? []).length,
      finalCount: finals.length,
      handoffCount: (hist.handoffs ?? []).length,
      finalFrom: finals.map((f) => f.finalReplyFromConclusion),
    };
  } catch (e) {
    archived = { error: e.message };
  }
  const extra = [];
  if (archived && !archived.error) {
    extra.push({
      id: 'no_unbacked_final_archived',
      pass: archived.finalCount === 0,
      level: 'fail',
      detail: `未回填人工结论 → 库里 isFinal=true 的回复数应为 0，实际 ${archived.finalCount}` +
              (archived.finalCount ? ` · finalReplyFromConclusion=${JSON.stringify(archived.finalFrom)}` : ''),
    });
  }
  return { ...out, archived, extraChecks: [...(out.extraChecks ?? []), ...extra] };
}

/**
 * BD-08 专用（第 3 轮新增）：**确定性**复现 R-2 的前提状态。
 *
 * BD-07 能不能走到「已交接·待人工结论」取决于模型当轮怎么判——冒烟时它就没走到，
 * 那一跑对 R-2 其实什么都没验到（前提不成立时的「通过」是假通过）。
 * 这里把状态钉死：真跑出 handoff → 真 ack → 真进入待结论态 → **不回填结论**再生成一次。
 * 判定看两处：verdict 不得是 final_reply；库里 isFinal=true 的回复数必须为 0。
 */
async function flowHandoffThenNoConclusion(sc, tag) {
  const s1 = await snap(sc, bid(sc, tag), sc.messages);
  const first = await api.generate({ buyerKey: s1.buyerKey, epoch: s1.epoch });
  if (first.rec?.verdict?.type !== 'handoff') {
    return {
      rec: first.rec, clientMs: first.clientMs, inputText: inputTextOf(s1.sent),
      trace: { note: `前置未产生 handoff（实际 ${first.rec?.verdict?.type}），未进入「待人工结论」态，本次采样验不到 R-2` },
      preconditionFailed: true,
    };
  }
  const hist = await api.get(`/api/history?buyerKey=${encodeURIComponent(s1.buyerKey)}`);
  const h = (hist.handoffs ?? []).at(-1);
  if (!h) throw new Error('handoff 记录未落库');
  await api.post(`/api/handoffs/${h.id}/ack`, {});   // AC-16：确认交接 → 进入待人工结论态

  // 关键：追加一句买家催问后再次生成，**不带 conclusionText**
  const s2 = await snap(sc, bid(sc, tag), [...sc.messages, sc.followUp]);
  const { rec, clientMs } = await api.generate({ buyerKey: s2.buyerKey, epoch: s2.epoch });

  const after = await api.get(`/api/history?buyerKey=${encodeURIComponent(s2.buyerKey)}`);
  const finals = (after.replies ?? []).filter((r) => r.isFinal);
  const archived = {
    replyCount: (after.replies ?? []).length,
    finalCount: finals.length,
    handoffCount: (after.handoffs ?? []).length,
    ackedHandoff: h.id,
    finalFrom: finals.map((f) => f.finalReplyFromConclusion),
  };
  return {
    rec, clientMs, inputText: inputTextOf(s2.sent),
    archived,
    extraChecks: [
      {
        id: 'r2_precondition_reached',
        pass: true,
        level: 'fail',
        detail: `前置已达成：handoff=${h.id} 已 ack，进入「已交接·待人工结论」，本轮未回填结论`,
      },
      {
        id: 'no_unbacked_final_archived',
        pass: archived.finalCount === 0,
        level: 'fail',
        detail: `待人工结论态 + 未回填 → 库里 isFinal=true 应为 0，实际 ${archived.finalCount}` +
                (archived.finalCount ? ` · finalReplyFromConclusion=${JSON.stringify(archived.finalFrom)}` : ''),
      },
    ],
    trace: { firstVerdict: first.rec?.verdict, handoffId: h.id, acked: true, secondVerdict: rec?.verdict },
  };
}

async function flowIsolation(sc, tag) {
  // A：本场景 mock（m001），带补充文本 + 图片证据
  const a = await snap(sc, bid(sc, `${tag}_a`), sc.messages ?? [{ role: 'buyer', text: MOCK[sc.mock].last, at: '2026-07-15T10:00:00+08:00' }]);
  await api.post('/api/supplement', { buyerKey: a.buyerKey, epoch: a.epoch, text: sc.supplementText });
  await api.post('/api/supplement', { buyerKey: a.buyerKey, epoch: a.epoch, pastedImage: { fileName: sc.supplementImage } });
  const genA1 = await api.generate({ buyerKey: a.buyerKey, epoch: a.epoch });

  // B：另一个 mock 买家（m003），无任何补充
  const bSent = snapshotOf(sc.otherMock, {
    buyerId: bid(sc, `${tag}_b`),
    messages: [{ role: 'buyer', text: MOCK[sc.otherMock].last, at: '2026-07-15T10:05:00+08:00' }],
    payload: PAYLOAD,
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

async function flowStaleEpoch(sc, tag) {
  const s1 = await snap(sc, bid(sc, tag), sc.messages);
  // 买家侧新增一条消息 → epoch bump（等价于客服切走/对话推进）
  const s2 = await snap(sc, bid(sc, tag), [...sc.messages, { role: 'buyer', text: '算了，你们别管了。', at: '2026-07-15T10:10:00+08:00' }]);
  if (s2.epoch === s1.epoch) throw new Error(`epoch 未 bump（${s1.epoch} -> ${s2.epoch}），场景前提不成立`);
  // 用旧 epoch 提交
  const r = await api.post('/api/generations', { buyerKey: s1.buyerKey, epoch: s1.epoch, wait: true }, { allowFail: true });
  const code = r.json?.error?.code ?? null;
  return {
    rec: null, clientMs: 0, inputText: inputTextOf(s1.sent),
    extraChecks: [
      {
        id: 'stale_epoch_rejected',
        pass: !r.ok,
        level: 'fail',
        detail: `旧 epoch=${s1.epoch}（当前 ${s2.epoch}）提交 → HTTP ${r.status} ${r.text.slice(0, 120)}`,
      },
      {
        // D-1 修复后的契约（第 3 版已复核，这里持续回归防回退）
        id: 'stale_epoch_semantic_code',
        pass: r.status === 409 && code === 'STALE_EPOCH',
        level: 'fail',
        detail: `期望 HTTP 409 + error.code=STALE_EPOCH（D-1 修复契约），实际 ${r.status} + code=${code}`,
      },
    ],
    trace: { epochOld: s1.epoch, epochNew: s2.epoch, submitStatus: r.status, submitBody: r.text.slice(0, 300) },
    skipVerdictChecks: true,
  };
}

const FLOWS = {
  single: flowSingle, turns: flowTurns, conclusion: flowConclusion,
  isolation: flowIsolation, 'stale-epoch': flowStaleEpoch,
  'turns-no-conclusion': flowTurnsNoConclusion,
  'handoff-then-no-conclusion': flowHandoffThenNoConclusion,
};

// ───────────────────────── runner ─────────────────────────

async function runOnce(sc, si) {
  const flow = FLOWS[sc.flow ?? 'single'];
  const tag = `_s${si}`;
  const t0 = Date.now();
  const out = await flow(sc, tag);
  const judgeSc = out.judgeAgainstMock ? { ...sc, mock: out.judgeAgainstMock } : sc;
  let verdictJudge = { checks: [], pass: true, fails: [], warns: [], fallback: detectFallback(out.rec) };
  if (!out.skipVerdictChecks) {
    verdictJudge = judgeOne(judgeSc, out.rec, {
      inputText: out.inputText,
      // 只有真的回填了人工结论的流程才允许 final_reply（R-2 回归的判定前提）
      hasConclusion: Boolean(sc.conclusionText),
    });
  }
  const checks = [...verdictJudge.checks, ...(out.extraChecks ?? [])];
  // advisory 场景（口径未定，PRD 没定义清楚）：只观察不作闸——
  // 所有 fail 降级为 warn，进报告交人复核，不参与放行判定。
  // 不该拿「我自己都说不清对错的题」去卡 dev。
  if (sc.advisory) {
    for (const c of checks) if (!c.pass && c.level === 'fail') { c.level = 'warn'; c.advisory = true; }
  }
  const fails = checks.filter((c) => !c.pass && c.level === 'fail');
  const warns = checks.filter((c) => !c.pass && c.level === 'warn');
  return {
    sample: si,
    pass: fails.length === 0 && !out.preconditionFailed,
    preconditionFailed: out.preconditionFailed ?? false,
    verdictType: out.rec?.verdict?.type ?? null,
    status: out.rec?.status ?? null,
    totalMs: out.rec?.totalMs ?? null,
    wallMs: Date.now() - t0,
    fallback: verdictJudge.fallback ?? detectFallback(out.rec),
    checks, fails, warns,
    input: out.inputText,
    output: out.rec?.verdict ?? null,
    processSteps: out.rec?.processSteps ?? null,
    archived: out.archived ?? null,
    trace: out.trace ?? null,
  };
}

async function runScenario(sc, n) {
  const samples = [];
  for (let i = 0; i < n; i++) {
    try {
      const r = await runOnce(sc, i);
      samples.push(r);
      log(`   ${sc.id} 采样 ${i + 1}/${n} → ${r.verdictType ?? r.status} ${r.pass ? '✅' : '❌ ' + r.fails.map((f) => f.id).join(',')} ${r.totalMs ?? r.wallMs}ms${r.fallback?.fallback ? ' ⚠兜底' : ''}`);
    } catch (e) {
      log(`   💥 ${sc.id} 采样 ${i + 1}/${n} 跑挂: ${e.message}`);
      samples.push({ sample: i, pass: false, error: e.message, checks: [], fails: [{ id: 'harness_error', detail: e.message }], warns: [], fallback: {} });
    }
  }
  const types = samples.map((s) => s.verdictType ?? s.status ?? 'none');
  const passN = samples.filter((s) => s.pass).length;
  const stab = judgeStability(types);
  return {
    id: sc.id, category: sc.category, title: sc.title, covers: sc.covers,
    rationale: sc.rationale, holdout: Boolean(sc.holdout),
    // burned：第 3 轮已公开的留出集，只当回归跑，不再作为泛化证据
    burned: Boolean(sc.burned),
    // advisory：口径观察项，不作放行闸
    advisory: Boolean(sc.advisory),
    n: samples.length,
    passN,
    // 兜底落到了哪一类——R-1(a) 的核心指标
    fallbackTypes: samples.map((s) => s.fallback?.fallbackType).filter(Boolean),
    // 阻断项 0 容忍：任一次采样命中阻断失败，该场景即不通过。
    // 「跑 5 次过了 4 次」不是通过——客服遇到的就是那 1 次。
    pass: passN === samples.length,
    consistency: stab,
    fallbackN: samples.filter((s) => s.fallback?.fallback).length,
    parseFailFirstTryN: samples.filter((s) => s.fallback?.parseFailedFirstTry).length,
    retriedOkN: samples.filter((s) => s.fallback?.retriedOk).length,
    samples,
  };
}

async function pool(items, k, fn) {
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(k, items.length)) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

function buildReport(runId, health, results, meta) {
  const byCat = {};
  for (const r of results) {
    byCat[r.category] ??= { total: 0, pass: 0 };
    byCat[r.category].total++;
    if (r.pass) byCat[r.category].pass++;
  }
  const allSamples = results.flatMap((r) => r.samples ?? []);
  // 过模型的样本才计入解析率分母（FL-02 在调模型前就被拒，不算）
  const modelSamples = allSamples.filter((s) => s.output);
  const passed = results.filter((r) => r.pass).length;
  const durations = allSamples.map((s) => s.totalMs).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  const p = (q) => (durations.length ? durations[Math.max(0, Math.ceil(q * durations.length) - 1)] : null);
  const fallbackN = allSamples.filter((s) => s.fallback?.fallback).length;
  const firstFailN = allSamples.filter((s) => s.fallback?.parseFailedFirstTry).length;
  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : null);
  return {
    runId,
    writtenAt: new Date().toISOString(),
    target: api.API_BASE,
    health,
    meta,
    summary: {
      scenarios: results.length, scenariosPassed: passed, scenariosFailed: results.length - passed,
      scenarioPassRatePct: pct(passed, results.length) ?? '0',
      samples: allSamples.length,
      samplesPassed: allSamples.filter((s) => s.pass).length,
      samplePassRatePct: pct(allSamples.filter((s) => s.pass).length, allSamples.length) ?? '0',
      byCategory: byCat,
      warnCount: results.reduce((a, r) => a + (r.samples ?? []).reduce((b, s) => b + (s.warns?.length ?? 0), 0), 0),
      // R-1 复测口径：
      //   兜底率     = 重试后仍解析失败 → 真正会伤到客服的比例
      //   首解析失败率 = 模型原始输出不合规的比例（含被重试救回来的）——修的是症状还是病根，看这个
      parse: {
        modelSamples: modelSamples.length,
        fallbackN, parseFailFirstTryN: firstFailN,
        retriedOkN: allSamples.filter((s) => s.fallback?.retriedOk).length,
        fallbackRatePct: pct(fallbackN, modelSamples.length),
        firstTryFailRatePct: pct(firstFailN, modelSamples.length),
        // R-1(a) 复测口径：兜底分别落到了哪一类。
        // 低风险场景兜成 handoff = AI-02「无故转人工」未清零（dev 声称已按风险分流）。
        fallbackByType: allSamples
          .filter((s) => s.fallback?.fallback)
          .reduce((a, s) => { const t = s.fallback.fallbackType ?? 'none'; a[t] = (a[t] ?? 0) + 1; return a; }, {}),
        // 部署校验：'降级为' 是 daf19334 才有的标记文案。
        // 出现过 ≥1 次 = 真机确实跑的是新 head（我没有该真机 SSH，只能靠行为指纹反推）。
        newCodeMarkerN: allSamples.filter((s) => s.fallback?.newCodeMarker).length,
      },
      latency: { n: durations.length, p50: p(0.5), p95: p(0.95), max: durations.at(-1) ?? null },
    },
    results,
  };
}

async function main() {
  mkdirSync('results', { recursive: true });
  const h = await api.health();
  log(`后端 ${api.API_BASE} → ${JSON.stringify(h)}`);

  const base = withHoldout ? [...SCENARIOS, ...HOLDOUT] : SCENARIOS;
  const list = base.filter((s) => !s.expect?.localOnly).filter((s) => !only || only.includes(s.id));
  // 硬闸：只要选中的场景里有一条要过模型，就必须是真链路。
  // FL-02(stale epoch) 在调用模型之前就被 submit 拒绝，故可在无凭据实例上单独跑通管路。
  const needsModel = list.some((s) => s.flow !== 'stale-epoch');
  if (needsModel && !h.modelConfigured) {
    throw new Error('modelConfigured=false —— 拒绝在非真链路上跑评测（mock 出来的通过率没有意义）');
  }
  log(`payload=${PAYLOAD}${PAYLOAD === 'ext' ? '（按真实扩展实际发出的字段）' : '（工作台 API 原始字段）'}`);
  log(`场景 ${list.length} 条（留出集${withHoldout ? '已' : '未'}纳入） 分类=${JSON.stringify(categoryCounts())} samples=${SAMPLES} concurrency=${CONCURRENCY} run=${RUN}`);

  const results = [];
  const meta = { samples: SAMPLES, concurrency: CONCURRENCY, holdout: withHoldout, payload: PAYLOAD, backendPin: process.env.BACKEND_PIN ?? null };
  // 每条跑完就落盘：2026-07-15 首跑在稳定性阶段被 ECONNRESET 打断，
  // 结果全在内存里 → 26 条真实样本全丢。证据必须边跑边写。
  const flush = () => writeFileSync(OUT, JSON.stringify(buildReport(RUN, h, [...results].sort((a, b) => a.id.localeCompare(b.id)), meta), null, 2));

  await pool(list, CONCURRENCY, async (sc) => {
    const n = sc.samplesOverride ?? SAMPLES;
    log(`▶ ${sc.id} [${CATEGORY_LABEL[sc.category]}]${sc.holdout ? ' [留出]' : ''} × ${n}`);
    const r = await runScenario(sc, n);
    results.push(r);
    log(`${r.pass ? '✅' : '❌'} ${sc.id} ${r.passN}/${r.n} 通过 · 众数=${r.consistency.topType} 一致率=${(r.consistency.ratio * 100).toFixed(0)}%${r.consistency.riskFlip ? ' ⚠跨风险翻转' : ''}${r.fallbackN ? ` ⚠兜底×${r.fallbackN}` : ''}`);
    flush();
  });

  flush();
  const report = buildReport(RUN, h, [...results].sort((a, b) => a.id.localeCompare(b.id)), meta);
  const s = report.summary;
  log(`—— 场景全过 ${s.scenariosPassed}/${s.scenarios} · 样本 ${s.samplesPassed}/${s.samples} (${s.samplePassRatePct}%) · 写入 ${OUT}`);
  log(`—— 兜底 ${s.parse.fallbackN}/${s.parse.modelSamples} (${s.parse.fallbackRatePct}%) · 首解析失败 ${s.parse.parseFailFirstTryN} (${s.parse.firstTryFailRatePct}%) · 重试救回 ${s.parse.retriedOkN}`);
  for (const [c, v] of Object.entries(s.byCategory)) log(`   ${CATEGORY_LABEL[c]}: ${v.pass}/${v.total}`);
  for (const r of report.results.filter((x) => !x.pass)) {
    log(`   ❌ ${r.id} ${r.passN}/${r.n} — ${[...new Set(r.samples.flatMap((x) => (x.fails ?? []).map((f) => f.id)))].join(',')}`);
  }
  for (const r of report.results.filter((x) => x.consistency?.ratio < 1)) {
    log(`   ~ ${r.id} 一致率=${(r.consistency.ratio * 100).toFixed(0)}% 分布=${JSON.stringify(r.consistency.counts)}${r.consistency.riskFlip ? ' ⚠跨风险翻转' : ''}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
