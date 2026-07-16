// 真实 mock 工作台的 10 单售后数据（口径来源：
//   GET http://43.173.83.222:8787/api/conversations ，2026-07-15 实拉）
// 评测场景一律基于这里的真数据构造，禁止另造商品线/买家名——
// 编造产品线是本系列历史上出过的事故。
export const MOCK = {
  m001: {
    buyerName: '小满不满_', level: '普通会员', order: '3304201117840045784',
    product: '【4K旗舰】海马爸比4代 AI智能婴儿看护器隐私保护看娃神器摄像头',
    model: 'HMB-REAL-001', problemType: '设备离线', emotion: '着急', risk: [],
    orderStatusText: '已支付 / 待收货', afterSale: '可发起退换货',
    logistics: '运输中，预计 1-2 天内送达',
    last: '刚买的看护器一直连不上，App 里一直显示离线，宝宝在睡觉我现在看不到画面。',
  },
  m002: {
    buyerName: '芝士妈妈', level: '新客', order: '3304201117840045785',
    product: '海马爸比二代看护器 AI智能婴儿哭声监测器 基础版与守护版可选',
    model: 'HMB-REAL-002', problemType: 'App 登录', emotion: '普通咨询', risk: ['首次售后'],
    orderStatusText: '已签收', afterSale: '可申请售后', logistics: '已签收',
    last: '我的 App 登录不上，一直提示账号被占用，这个要怎么处理？',
  },
  m003: {
    buyerName: '小鹿要早睡', level: '复购用户', order: '3304201117840045786',
    product: '海马爸比婴儿看护器 热成像宝宝监护器 三代旗舰版看护器',
    model: 'HMB-REAL-003', problemType: '退货退款', emotion: '不满', risk: ['退款争议', '情绪较高'],
    orderStatusText: '退款审核中', afterSale: '售后审核中', logistics: '平台售后流程中',
    last: '这个设备我不想要了，申请退款一直没结果，你们能不能尽快处理？',
  },
  m004: {
    buyerName: '木木家的星星', level: '普通会员', order: '3304201117840045787',
    product: '海马爸比二代升级版4K看护机 皓日黄高清画质适用多月龄婴儿',
    model: 'HMB-REAL-004', problemType: '发货物流', emotion: '普通咨询', risk: [],
    orderStatusText: '已支付 / 待发货', afterSale: '未发起售后', logistics: '仓库已接单，等待出库',
    last: '我下单后一直没看到物流更新，请问什么时候发货？',
  },
  m005: {
    buyerName: '橙子妈咪', level: '复购用户', order: '3304201117840045788',
    product: '【4K旗舰】海马爸比4代 AI智能婴儿看护器隐私保护看娃神器摄像头',
    model: 'HMB-REAL-005', problemType: '云台控制', emotion: '着急', risk: [],
    orderStatusText: '售后已关闭', afterSale: '售后已关闭', logistics: '已签收',
    last: '摄像头点旋转没反应，左右上下都不动，是不是坏了？',
  },
  m006: {
    buyerName: '江南小贝', level: '新客', order: '3304201117840045789',
    product: '海马爸比二代看护器 AI智能婴儿哭声监测器 基础版与守护版可选',
    model: 'HMB-REAL-006', problemType: '智能提醒', emotion: '着急', risk: ['情绪较高'],
    orderStatusText: '已支付 / 待收货', afterSale: '可发起退换货', logistics: '运输中',
    last: '宝宝醒了 App 没有提醒，智能看护是不是没生效？',
  },
  m007: {
    buyerName: '豆包爸爸', level: '普通会员', order: '3304201117840045790',
    product: '海马爸比监控专用内存卡 摄像头看护器高速SD卡 TF存储卡',
    model: 'HMB-REAL-007', problemType: '录像回放', emotion: '普通咨询', risk: [],
    orderStatusText: '已签收', afterSale: '可申请售后', logistics: '已签收',
    last: '我插了内存卡，但是 App 里一直识别不到，录像回放也没有。',
  },
  m008: {
    buyerName: '奶糖不甜', level: '复购用户', order: '3304201117840045791',
    product: '海马爸比二代升级版4K看护机 皓日黄高清画质适用多月龄婴儿',
    model: 'HMB-REAL-008', problemType: 'App 设置', emotion: '普通咨询', risk: [],
    orderStatusText: '退款审核中', afterSale: '售后审核中', logistics: '已签收',
    last: 'App 里这个设置在哪？我找不到智能提醒的入口。',
  },
  m009: {
    buyerName: '阿布爱睡觉', level: '普通会员', order: '3304201117840045792',
    product: '【4K旗舰】海马爸比4代 AI智能婴儿看护器隐私保护看娃神器摄像头',
    model: 'HMB-REAL-009', problemType: '功能咨询', emotion: '普通咨询', risk: [],
    orderStatusText: '已支付 / 待发货', afterSale: '未发起售后', logistics: '仓库已接单',
    last: '这款能不能远程看宝宝？家里老人也想一起看，需要怎么设置？',
  },
  m010: {
    buyerName: '西柚和风', level: '新客', order: '3304201117840045793',
    product: '海马爸比二代看护器 AI智能婴儿哭声监测器 基础版与守护版可选',
    model: 'HMB-REAL-010', problemType: '售后投诉', emotion: '投诉风险', risk: ['情绪较高'],
    orderStatusText: '售后已关闭', afterSale: '售后已关闭', logistics: '已签收',
    last: '刚买就用不了，影响我晚上看宝宝，这个你们总要给个说法吧。',
  },
};

/** 除当前买家外的所有买家名 / 订单号——串买家检查用 */
export function othersOf(currentKey) {
  const names = [], orders = [];
  for (const [k, v] of Object.entries(MOCK)) {
    if (k === currentKey) continue;
    names.push(v.buyerName);
    orders.push(v.order);
  }
  return { names, orders };
}

/**
 * 把 mock 单转成后端 /api/session-snapshots 的 body。
 *
 * payload 模式（第 4 轮新增，默认 'api'）：
 *
 *   'api' —— 按**工作台 API 原始字段**喂：emotion='着急'、problemType='设备离线'、riskHint='退款争议/情绪较高'…
 *            这是评测集前三轮一直用的口径，字段值忠实于 GET /api/conversations。
 *
 *   'ext' —— 按**真实扩展实际发出的**字段喂。第 4 轮核对 after-sales-rrs6-extension@71004d98
 *            的三个 adapter（mockWorkbench/taobao/jd）后发现，扩展与工作台 API **并不一致**：
 *              · `emotion: emotionHot ? '高情绪' : undefined`（mockWorkbench.ts:80）
 *                —— 只在 `.hot` 存在时给字符串「高情绪」，且工作台仅当 riskTags 非空才渲染 `.hot`
 *                   （taobao-customer-workbench.html:2178），故等价于 riskTags 非空 → '高情绪'，否则不传；
 *              · **problemType / riskHint 三个 adapter 一个都不发**（全仓 grep 无赋值）；
 *              · taobao.ts / jd.ts 连 emotion 都不发。
 *            而后端 promptBuilder.ts:66-68 会把这三个字段作为「情绪标签(页面自带)/问题分类(页面自带)/
 *            风险提示(页面自带)」拼进 prompt，parser.isHighRiskContext 也拿它们做兜底风险分流。
 *
 * 为什么必须有 'ext'：用 'api' 口径评出来的路由准确率，是在给模型喂**真实产品拿不到的**风险提示。
 * 「风险提示: 退款争议/情绪较高」这一行几乎等于把答案写在卷子上——评的就不再是产品的判定能力。
 * 放行结论必须以 'ext' 口径为准；'api' 口径的结果只用于跟前三轮对账。
 */
/**
 * 逐字复刻 extension@a103901 `mockWorkbench.ts:41-52` 的 toEmotionSignal。
 * 这是被测系统的**契约边界**：扩展只发这 4 个枚举值，后端 zod 也只收这 4 个。
 * 复刻而非 import：扩展是 TS + 依赖 DOM，评测集是纯 ESM 脚本；
 * 代价是「两边可能漂」，故 lib/ext-contract.test.mjs 用扩展源码文本做了指纹回归。
 */
export function toEmotionSignal(raw) {
  if (!raw) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  if (s === '普通咨询' || s === '正常' || s === '中立' || s === '普通') return undefined;
  if (s === '着急' || s === '焦虑' || s === '担心') return 'anxious';
  if (s === '不满' || s === '愤怒' || s === '生气') return 'angry';
  if (s === '投诉风险' || s === '投诉' || s === '曝光' || s === '威胁') return 'complaint';
  return undefined;
}

export function snapshotOf(key, { buyerId, messages, dropSku = false, anonymous = false, payload = 'api' }) {
  const m = MOCK[key];
  const base = {
    platform: 'mock',
    buyerId,
    buyerName: anonymous ? undefined : m.buyerName,
    isNewUser: anonymous ? true : undefined,
    snippet: (messages.at(-1)?.text ?? m.last).slice(0, 200),
    recentMessages: messages,
  };
  if (payload === 'ext') {
    // 复刻 extension@a103901 的 mockWorkbench.readMockWorkbench（R-5 修复后版本）。
    // 第 5 轮这里复刻的是 R-5 修复**前**的行为（emotion=「有任意标签就高情绪」、
    // problemType/riskTags/logistics 一律不发）。dev 已在 4b0ebdd3 修掉，
    // 若不同步更新，本轮就会重演「测一个不存在的系统」——这次是反向的：
    // 拿旧扩展的贫瘠 payload 去评新后端，会把 dev 已修好的透传评成没修。
    //
    // 逐字段对照 src/content/adapters/mockWorkbench.ts:150-190：
    //   productTitle = api.productShortName || api.productName
    //   productModel = api.productModel —— 该工作台三者相等，故 `productModel !== productTitle`
    //                  为假，「型号: X」**不会**进 meta（dev 补的型号透传在本工作台是 no-op）
    //   logistics    = api.logisticsStatus || DOM 订单状态
    //   emotion      = toEmotionSignal(api.emotion) —— 中文字面串 → 枚举，'普通咨询' → undefined
    //   riskTags     = api.riskTags 原样数组（空数组 → undefined）
    //   problemType  = api.problemType 原样
    const meta = `会员等级: ${m.level}`; // 型号与商品名相等 → 按扩展逻辑不进 meta
    return {
      ...base,
      sku: dropSku ? null : { name: m.product, meta, order: m.order, logistics: m.logistics },
      emotion: toEmotionSignal(m.emotion),
      problemType: m.problemType,
      riskTags: m.risk.length ? m.risk : undefined,
      pageUrl: 'http://43.173.83.222/taobao-customer-workbench.html',
    };
  }
  return {
    ...base,
    sku: dropSku ? null : { name: m.product, meta: m.model, order: m.order, logistics: m.logistics },
    emotion: m.emotion,
    problemType: m.problemType,
    riskHint: m.risk.join('/') || undefined,
  };
}

export function buyerMsg(text, at = '2026-07-15T10:00:00+08:00') {
  return { role: 'buyer', text, at };
}
export function sellerMsg(text, at = '2026-07-15T10:01:00+08:00') {
  return { role: 'seller', text, at };
}
