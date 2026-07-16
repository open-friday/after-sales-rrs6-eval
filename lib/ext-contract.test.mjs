// 扩展契约指纹回归。
//
// 为什么存在：本评测集**复刻**（而非 import）扩展 mockWorkbench 的字段映射，
// 因为扩展是依赖 DOM 的 TS、评测集是纯 ESM。复刻的代价是会漂：
//   - 第 3~5 轮：我复刻的是「工作台 API 原值」，而扩展根本不发那些字段 → 三轮结论建立在不存在的系统上；
//   - 第 5 轮末：dev 改了兜底文案，我的两路探针同时失效，差点把兜底率读成 0。
// 两次都是「被测系统变了，我的量尺没变，而量尺不会自己报错」。
//
// 用法（可选但强烈建议，跑测前执行）：
//   EXT_SRC=/path/to/after-sales-rrs6-extension node --test lib/ext-contract.test.mjs
// 不给 EXT_SRC 时只跑映射表自检并**显式告警**——不假装验过。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { toEmotionSignal, MOCK, snapshotOf } from './mockdata.mjs';

const EXT_SRC = process.env.EXT_SRC;
const ADAPTER = EXT_SRC ? `${EXT_SRC}/src/content/adapters/mockWorkbench.ts` : null;

test('toEmotionSignal 映射表（契约枚举 EmotionSignal）', () => {
  assert.equal(toEmotionSignal('普通咨询'), undefined, '中性字面串不得产生情绪信号');
  assert.equal(toEmotionSignal('着急'), 'anxious');
  assert.equal(toEmotionSignal('不满'), 'angry');
  assert.equal(toEmotionSignal('投诉风险'), 'complaint');
  assert.equal(toEmotionSignal(undefined), undefined);
  assert.equal(toEmotionSignal('莫名其妙的新值'), undefined, '未知值必须降级为 undefined，不得瞎猜');
});

test('R-5 回归：芝士妈妈(m002) 的「首次售后」不得变成情绪信号', () => {
  const snap = snapshotOf('m002', { buyerId: 'x', messages: [], payload: 'ext' });
  assert.equal(snap.emotion, undefined, 'emotion=普通咨询 → 不发信号');
  assert.deepEqual(snap.riskTags, ['首次售后'], 'riskTags 必须原样透传，不得翻译成情绪');
  assert.notEqual(snap.emotion, '高情绪', 'R-5 的病根：有任意标签就标高情绪');
});

test('ext 口径必须透传后端 prompt 槽位真正会用的字段', () => {
  const snap = snapshotOf('m001', { buyerId: 'x', messages: [], payload: 'ext' });
  assert.equal(snap.problemType, '设备离线', 'problemType 已由 dev 补透传');
  assert.ok(snap.sku.logistics, 'logistics 已由 dev 补透传（旧版反问买家页面上已有的信息）');
  assert.equal(snap.emotion, 'anxious', '着急 → anxious（且 promptBuilder 明写它不是高风险信号）');
});

// ── 指纹：直接对被测扩展源码断言，防止「我的量尺静默失效」 ──
test('指纹：我的复刻与扩展源码一致', { skip: !EXT_SRC && '未设 EXT_SRC，跳过（本轮结论不得据此声称已验证契约）' }, () => {
  assert.ok(existsSync(ADAPTER), `找不到扩展 adapter: ${ADAPTER}`);
  const src = readFileSync(ADAPTER, 'utf8');

  // 1) emotion 映射：扩展里每一条字面串都必须在我的表里给出同样的枚举
  const pairs = [
    ['普通咨询', undefined], ['正常', undefined], ['中立', undefined], ['普通', undefined],
    ['着急', 'anxious'], ['焦虑', 'anxious'], ['担心', 'anxious'],
    ['不满', 'angry'], ['愤怒', 'angry'], ['生气', 'angry'],
    ['投诉风险', 'complaint'], ['投诉', 'complaint'], ['曝光', 'complaint'], ['威胁', 'complaint'],
  ];
  for (const [literal, expected] of pairs) {
    assert.ok(src.includes(`'${literal}'`), `扩展源码里已不再出现 '${literal}' —— 映射表漂了，请重新对照 toEmotionSignal`);
    assert.equal(toEmotionSignal(literal), expected, `'${literal}' 的枚举与扩展不一致`);
  }

  // 2) 扩展必须仍从 API 缓存取语义字段（R-5 的修法本身）；若回退成读 DOM，本评测集的 ext 口径立即失真
  assert.match(src, /toEmotionSignal\(api\?\.emotion\)/, 'emotion 不再来自 API 缓存 → R-5 修法被改动');
  assert.match(src, /riskTags/, 'riskTags 透传消失');
  assert.match(src, /problemType/, 'problemType 透传消失');

  // 3) R-5 病根不得复活。
  // 注意：必须先剥注释再断言——扩展的注释里正当地提到「历史 R-5 把有任意标签错映射成"高情绪"」，
  // 拿裸正则扫全文会把这句**讲述修复的注释**判成病根复活。
  // 这正是我自己栽了四轮的同一个坑（字面正则判语义），在自己的量尺里也一样要防。
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // 行注释（避开 http:// ）
  assert.ok(!/emotion\s*[:=]\s*['"`]高情绪['"`]/.test(code), 'R-5 病根复活：又把 emotion 赋成「高情绪」字面串');
  assert.ok(!/riskTags[\s\S]{0,40}\?\s*['"`]高情绪['"`]/.test(code), 'R-5 病根复活：又把「有任意标签」翻译成高情绪');
});
