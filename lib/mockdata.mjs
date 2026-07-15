// 真实 mock 工作台的 10 单售后数据（口径来源：
//   GET http://43.173.83.222:8787/api/conversations ，2026-07-15 实拉）
// 评测场景一律基于这里的真数据构造，禁止另造商品线/买家名——
// 编造产品线是本系列历史上出过的事故。
export const MOCK = {
  m001: {
    buyerName: '小满不满_', order: '3304201117840045784',
    product: '【4K旗舰】海马爸比4代 AI智能婴儿看护器隐私保护看娃神器摄像头',
    model: 'HMB-REAL-001', problemType: '设备离线', emotion: '着急', risk: [],
    orderStatusText: '已支付 / 待收货', afterSale: '可发起退换货',
    logistics: '运输中，预计 1-2 天内送达',
    last: '刚买的看护器一直连不上，App 里一直显示离线，宝宝在睡觉我现在看不到画面。',
  },
  m002: {
    buyerName: '芝士妈妈', order: '3304201117840045785',
    product: '海马爸比二代看护器 AI智能婴儿哭声监测器 基础版与守护版可选',
    model: 'HMB-REAL-002', problemType: 'App 登录', emotion: '普通咨询', risk: ['首次售后'],
    orderStatusText: '已签收', afterSale: '可申请售后', logistics: '已签收',
    last: '我的 App 登录不上，一直提示账号被占用，这个要怎么处理？',
  },
  m003: {
    buyerName: '小鹿要早睡', order: '3304201117840045786',
    product: '海马爸比婴儿看护器 热成像宝宝监护器 三代旗舰版看护器',
    model: 'HMB-REAL-003', problemType: '退货退款', emotion: '不满', risk: ['退款争议', '情绪较高'],
    orderStatusText: '退款审核中', afterSale: '售后审核中', logistics: '平台售后流程中',
    last: '这个设备我不想要了，申请退款一直没结果，你们能不能尽快处理？',
  },
  m004: {
    buyerName: '木木家的星星', order: '3304201117840045787',
    product: '海马爸比二代升级版4K看护机 皓日黄高清画质适用多月龄婴儿',
    model: 'HMB-REAL-004', problemType: '发货物流', emotion: '普通咨询', risk: [],
    orderStatusText: '已支付 / 待发货', afterSale: '未发起售后', logistics: '仓库已接单，等待出库',
    last: '我下单后一直没看到物流更新，请问什么时候发货？',
  },
  m005: {
    buyerName: '橙子妈咪', order: '3304201117840045788',
    product: '【4K旗舰】海马爸比4代 AI智能婴儿看护器隐私保护看娃神器摄像头',
    model: 'HMB-REAL-005', problemType: '云台控制', emotion: '着急', risk: [],
    orderStatusText: '售后已关闭', afterSale: '售后已关闭', logistics: '已签收',
    last: '摄像头点旋转没反应，左右上下都不动，是不是坏了？',
  },
  m006: {
    buyerName: '江南小贝', order: '3304201117840045789',
    product: '海马爸比二代看护器 AI智能婴儿哭声监测器 基础版与守护版可选',
    model: 'HMB-REAL-006', problemType: '智能提醒', emotion: '着急', risk: ['情绪较高'],
    orderStatusText: '已支付 / 待收货', afterSale: '可发起退换货', logistics: '运输中',
    last: '宝宝醒了 App 没有提醒，智能看护是不是没生效？',
  },
  m007: {
    buyerName: '豆包爸爸', order: '3304201117840045790',
    product: '海马爸比监控专用内存卡 摄像头看护器高速SD卡 TF存储卡',
    model: 'HMB-REAL-007', problemType: '录像回放', emotion: '普通咨询', risk: [],
    orderStatusText: '已签收', afterSale: '可申请售后', logistics: '已签收',
    last: '我插了内存卡，但是 App 里一直识别不到，录像回放也没有。',
  },
  m008: {
    buyerName: '奶糖不甜', order: '3304201117840045791',
    product: '海马爸比二代升级版4K看护机 皓日黄高清画质适用多月龄婴儿',
    model: 'HMB-REAL-008', problemType: 'App 设置', emotion: '普通咨询', risk: [],
    orderStatusText: '退款审核中', afterSale: '售后审核中', logistics: '已签收',
    last: 'App 里这个设置在哪？我找不到智能提醒的入口。',
  },
  m009: {
    buyerName: '阿布爱睡觉', order: '3304201117840045792',
    product: '【4K旗舰】海马爸比4代 AI智能婴儿看护器隐私保护看娃神器摄像头',
    model: 'HMB-REAL-009', problemType: '功能咨询', emotion: '普通咨询', risk: [],
    orderStatusText: '已支付 / 待发货', afterSale: '未发起售后', logistics: '仓库已接单',
    last: '这款能不能远程看宝宝？家里老人也想一起看，需要怎么设置？',
  },
  m010: {
    buyerName: '西柚和风', order: '3304201117840045793',
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

/** 把 mock 单转成后端 /api/session-snapshots 的 body */
export function snapshotOf(key, { buyerId, messages, dropSku = false, anonymous = false }) {
  const m = MOCK[key];
  return {
    platform: 'mock',
    buyerId,
    buyerName: anonymous ? undefined : m.buyerName,
    isNewUser: anonymous ? true : undefined,
    snippet: (messages.at(-1)?.text ?? m.last).slice(0, 200),
    recentMessages: messages,
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
