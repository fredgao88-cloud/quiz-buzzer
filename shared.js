// =====================================================
// 荣资商厦服务技能大赛 - 共享状态模块 v3
// 文件: shared.js
// 用途: 状态定义 + 业务逻辑 + TTS + 计时器 + 抽签 + 翻牌
//
// 两页面通信:
//   localStorage (持久化 + 跨窗口 storage 事件)
//   BroadcastChannel (低延迟实时广播)
// 无后端，双击 HTML 即可运行。
// =====================================================

'use strict';

// ── 常量 ───────────────────────────────────────────
const STORAGE_KEY = 'rz_contest_v3';
const BC_NAME     = 'rz_contest_channel_v3';

// 代码版本号。改完代码就把它 +1。
// 为什么需要：控制台和大屏是两个独立页面，只刷新其中一个是常事，
// 结果就是「代码明明改了、界面还是老样子」—— 排查这种情况极费时间，
// 因为两个页面看起来都正常，只是其中一个跑着旧逻辑。
// 有了它：控制台顶栏显示自己的版本，并在发现大屏版本不一致时亮红字。
const APP_BUILD = '2026-07-28.14';

const TEAM_COLORS = ['#ef4444','#f59e0b','#22c55e','#3b82f6','#a855f7'];

// 扁平题型池里的全部题型（spot/theme 是单独上传的题源，不在其中）
const POOL_TYPES = ['judge', 'single', 'multi', 'fill', 'fill_multi'];

// 抢答发令音「滴」的默认参数。会场大小、音响好坏差别很大，做成可配
//（设置 → ③擂台抢答 → 系统读题）。默认值按「有人声、有掌声的空旷会场」调：
// 足够长到听清，又不至于拖慢发令节奏。
// ⚠️ 必须定义在 defaultState() 之前 —— 它在 r3.beep 里引用本常量，
// 而 defaultState() 在本文件加载时（let state = defaultState()）就会执行，
// 定义晚了会撞上 TDZ，state 初始化直接抛异常、整个页面挂掉。
const BEEP_DEFAULT = { ms: 450, gain: 0.9 };

// ── 计分配置 ───────────────────────────────────────
// 每题分值由【环节】决定，不再从题库读（题库的 score_correct/score_wrong 一律忽略）。
// 赛制每天可能不同，所以全部放进 state.scoreCfg，在 设置 → 各环节计分 里改。
// 这里只是「旧存档缺字段时的兜底默认值」，实际取值一律走 getScoreCfg()。
//   correct/wrong —— 每题得分/扣分      perSpot —— R4 每找出一处的分
//   valid/winner  —— R5 每条有效答案/擂主   cap —— 本环节每队封顶，null=不封顶
const SCORE_CFG_DEFAULT = {
  r1: { correct: 2.5,             cap: 20   },
  r2: { correct: 5,               cap: 20   },
  r3: { correct: 2, wrong: -2,    cap: null },
  r4: { perSpot: 1,               cap: 10   },
  r5: { valid: 1,   winner: 3,    cap: null },
};

/** 取某环节的计分配置，逐字段兜底（cap 允许为 null，故用 undefined 判断） */
function getScoreCfg(roundKey) {
  const d = SCORE_CFG_DEFAULT[roundKey] || {};
  const c = state.scoreCfg?.[roundKey] || {};
  const out = { ...d };
  for (const k of Object.keys(d)) if (c[k] !== undefined) out[k] = c[k];
  return out;
}

// 违规处罚分。都是对【行为】的处罚，与题目分值无关，因此不读 q.score_wrong
//（那是「答错」的分值）。赛制若调整违规标准，改这里即可。
const R1_VIOLATION_PENALTY = -2;   // R1 个人必答：队内外提示 → 本题 0 分且队伍 -2
const R3_VIOLATION_PENALTY = -2;   // R3 擂台抢答：读题期抢跑

// R4 每张图的找茬点上限，超过后 UI 拒绝继续勾选（与 ROUND_CAPS.r4 同值但语义不同：
// 前者是单图点数上限，后者是队伍在本环节的累计得分上限）
const R4_MAX_SPOTS = 10;

// R5 评委未录入答案内容时的占位符。它不是真实答案，不参与查重
// （否则两队都留空会被判成互相重复）
const R5_BLANK_ANSWER = '（未录入）';

// ── BroadcastChannel ──────────────────────────────
let bc = null;
try { bc = new BroadcastChannel(BC_NAME); } catch(e) {}

// ── 默认状态 ──────────────────────────────────────
function defaultTeams() {
  return [
    { id:1, name:'红队', color:TEAM_COLORS[0], members:['队员1','队员2','队员3','队员4'], scores:{r1:0,r2:0,r3:0,r4:0,r5:0}, memberScores:{0:0,1:0,2:0,3:0} },
    { id:2, name:'黄队', color:TEAM_COLORS[1], members:['队员1','队员2','队员3','队员4'], scores:{r1:0,r2:0,r3:0,r4:0,r5:0}, memberScores:{0:0,1:0,2:0,3:0} },
    { id:3, name:'绿队', color:TEAM_COLORS[2], members:['队员1','队员2','队员3','队员4'], scores:{r1:0,r2:0,r3:0,r4:0,r5:0}, memberScores:{0:0,1:0,2:0,3:0} },
    { id:4, name:'蓝队', color:TEAM_COLORS[3], members:['队员1','队员2','队员3','队员4'], scores:{r1:0,r2:0,r3:0,r4:0,r5:0}, memberScores:{0:0,1:0,2:0,3:0} },
    { id:5, name:'紫队', color:TEAM_COLORS[4], members:['队员1','队员2','队员3','队员4'], scores:{r1:0,r2:0,r3:0,r4:0,r5:0}, memberScores:{0:0,1:0,2:0,3:0} },
  ];
}

function defaultState() {
  return {
    // 状态版本号，每次 save() 自增。跨页面同步用它丢弃过期快照，详见 save()
    rev: 0,

    // ── 元数据 ──────────────────────────────────
    teams: defaultTeams(),
    keymap: { 1:['1','q','Q'], 2:['2','w','W'], 3:['3','e','E'], 4:['4','r','R'], 5:['5','t','T'] },
    logo: null,
    brandName: '',
    prepBg: null,            // 赛前准备大屏背景图（整屏铺满）
    questionBg: null,        // 题目页大屏背景图（出题/翻牌/抽签等界面的底图）
    // 各环节规则说明（大屏翻牌选题时显示在上方窗口）。按环节号存，可自行维护文案。
    // 文案里的数字一律用 {占位符}，显示/朗读前由 fillRuleVars() 按当前配置替换，
    // 免得改了计分或倒计时，念出来的规则和实际判分对不上。可用占位符见 ruleVars()。
    roundRules: {
      1: '一、每队选手依次上场，每人连答 {题数} 题。\n二、听到「请某队队员某某翻牌」后 {翻牌秒数} 秒内翻牌选题，超时本环节不得分。\n三、答对每题得 {分值} 分，答错或超时不得分、不倒扣。\n四、每队本环节{上限}。\n五、每题限时 {秒数} 秒，倒计时结束即停止作答。',
      2: '一、各队按抽签顺序依次上场，每队翻牌后连答 {题数} 道题。\n二、听到「请某队翻牌」后 {翻牌秒数} 秒内翻牌选题，超时本环节不得分。\n三、每题由一名队员作答，作答队员现场指定。\n四、答对每题得 {分值} 分，答错或超时不得分、不倒扣。\n五、每队本环节{上限}。\n六、每题限时 {秒数} 秒。',
      3: '一、主持人出题并宣布「开始抢答」后，各队方可按抢答器。\n二、最先抢到的队伍作答，答对加 {分值} 分，答错扣 {扣分} 分。\n三、抢答犯规（抢答口令前抢按）扣分并暂停一次抢答资格。\n四、每题限时 {秒数} 秒，本环节{上限}。',
      4: '一、各队依次上场，在场景图中找出服务不规范之处。\n二、每找对一处得 {分值} 分，每图至多 {处数} 处。\n三、每队本环节{上限}。\n四、限时 {秒数} 秒，时间到即停止作答，误报不倒扣。',
      5: '一、各队围绕主题轮流说出符合要求的服务用语或要点。\n二、每答出一条有效内容得 {分值} 分；本题擂主额外得 {擂主分} 分。\n三、重复、不符或 {秒数} 秒内答不出即淘汰出本题。\n四、本环节{上限}。',
    },
    roundRulesDismissed: {}, // 规则朗读完毕后置 true，大屏据此自动关闭规则窗口

    // ── 题库 ────────────────────────────────────
    // 扁平题型池：池子里的题【不带 round】，环节不预分配，由各环节按 roundCfg
    // 随机抽取；抽过的记进 usedQIds，全场（跨环节）不再重复抽。
    // 识图找茬(spot) / 飞花令(theme) 是单独上传的题源，带 round:4 / round:5，不参与随机抽取。
    questions: [],           // 完整题库数组
    usedQIds:  [],           // 全场已抽走的题目 id（R1/R2/R3 共用一个池子，互不重复）

    // 各环节抽题配置，全部在设置面板里改。
    //
    // R1/R2 是「一张牌连答几题」，每一题的题型要按顺序指定：
    //   turns   —— 翻几张牌（R2 恒等于队伍数，每队一张，此处不生效）
    //   perTurn —— 一张牌里连答几题
    //   types   —— 长度须等于 perTurn，逐题指定题型；'any' = 任意题型随机
    //
    // R3 抢答是一题一抽、没有「第几题」的概念，配的是【允许抽哪些题型】：
    //   turns    —— 本环节计划出多少题（0 = 不限，出到池子空）
    //   typePool —— 允许的题型集合（可多选）；空/缺配 = 全部题型
    roundCfg: {
      1: { turns: 20, perTurn: 3, types: ['judge', 'single', 'fill'] },
      2: { turns: 5,  perTurn: 4, types: ['multi', 'multi', 'fill_multi', 'fill_multi'] },
      // typePool 默认留空 = 不限题型。不写死一组题型，是为了给旧存档的
      // 迁移让路（见 getR3TypePool）：留空才轮得到旧的 types 字段说话。
      3: { turns: 25, typePool: [] },
      // R4 只用 turns —— 本环节出几道图题（= 发几张牌）。0 = 按队伍数，每队一张。
      // 图题是单独上传的题源（type:'spot'），不参与题型池抽取，所以没有 perTurn/types。
      4: { turns: 0 },
    },

    // 各环节计分（每题分值 + 每队封顶）。赛制按天调整就改这里，与题库无关。
    // 字段含义见文件顶部 SCORE_CFG_DEFAULT。
    scoreCfg: JSON.parse(JSON.stringify(SCORE_CFG_DEFAULT)),

    // ── 赛程控制 ────────────────────────────────
    currentRound: 0,         // 0=赛前, 1-5=对应环节
    roundPhase: 'idle',      // idle|running|judging|finished

    // ── 第一环节 个人必答 ────────────────────────
    r1: {
      currentTeamIdx:  0,    // 指向 draw.teamOrder 的下标
      currentMemberIdx: 0,   // 0-3
      currentQIdx:     null, // 当前题目在 questions[] 中的索引
      usedQIds:        [],   // 已用题目 id
      timerSec:        15,   // 答题倒计时
      flipTimerSec:    10,   // 翻牌倒计时：报完「请某某翻牌」后开始，0=不计时
      autoAdvance:     true, // 判分播报完后自动切到下一位答题人
      turnQIds:        [],   // 当前这次翻牌抽到的题目 id，按 roundCfg[1].types 顺序排列
      turnSubIdx:      0,    // 当前答到 turnQIds 里的第几题（0-based）
    },

    // ── 第二环节 团队共答 ────────────────────────
    r2: {
      currentTeamIdx:   0,    // 指向 draw.teamOrder（当前上场队，按赛前抽签顺序）
      currentMemberIdx: 0,    // 后台手动选的答题队员（仅屏幕显示/语音，不计分）
      turnQIdxs:        [],   // 本队本轮要答的题在 questions[] 的索引（各队同一组）
      qNum:             0,    // 本轮第几题（0 起）
      turnResults:      [],   // 本轮每题结果 [{correct, delta}]
      currentQIdx:      null,
      usedQIds:         [],
      timerSec:         40,
      flipTimerSec:     10,   // 翻牌倒计时：报完「请某队翻牌」后开始，0=不计时。与 R1 同规则
    },

    // ── 第三环节 擂台抢答 ────────────────────────
    r3: {
      currentQIdx:     null,
      usedQIds:        [],
      timerSec:        15,
      // 系统读题：开启后整个环节自跑 —— 读规则 → 自动出题 → 报题 → 念「开始抢答」
      // → 三、二、一 → 滴（滴响才开抢）→ 判分后自动出下一题，直到出满题数。
      autoRead:        false,
      beep:            { ...BEEP_DEFAULT },   // 发令音「滴」的时长与音量，见 getBeepCfg
      buzzState:       'idle',   // idle|reading|armed|locked
      buzzedTeam:      null,
      selectedTeam:    null,
      selectedMember:  null,
      buzzPulse:       0,
      lastBuzzTeam:    null,
      // 发令倒数当前念到几：3/2/1，0=正在响「滴」，null=不在倒数。
      // 大屏据此把右上角倒计时牌切成倒数画面（见 display.html updateTimer）。
      goCount:         null,
      excludedTeams:   [],   // 本题已抢答过（判错/超时）的队伍 id，防止重复抢答
      currentReadText: '',
    },

    // ── 第四环节 识图找茬 ────────────────────────
    // 图题【不在赛前分配】：翻开牌的那一刻才从「本场还没用过的图」里随机抽一张。
    // 所以 draw 里没有 r4ImageMap —— 谁拿到哪张图，翻牌前谁也不知道。
    r4: {
      currentTeamIdx: 0,     // 指向 draw.teamOrder 的下标
      currentQIdx:    null,  // 当前图题在 questions[] 中的索引
      usedQIds:       [],    // 本场已抽走的图题 id，防止两队抽到同一张图
      timerSec:       60,
      spotJudge:      {},    // {spotKey: true/false} 评委勾选结果
      extraSpots:     [],    // 评委现场认定额外找茬点
      // 图片路径不在这里存 —— 写在题库 spot 题的 image 字段里，见 getR4ImageSrc
      // 找茬点在图上的位置：{ imageKey: { spotKey: {x, y} } }，x/y 是相对图片
      // 【显示尺寸】的百分比（0~100），所以换分辨率、换屏幕都不用重标。
      // 不写进 questions.json：题库是导入件，坐标是跟着本地图片走的现场配置。
      // 在 设置 → ④识图找茬 → 场景图 → [标注找茬点] 里点图录入。
      spotPos: {},
    },

    // ── 第五环节 服务飞花令 ──────────────────────
    r5: {
      currentThemeIdx: 0,
      teamOrder:       [],   // 由 initR5() 从 draw.teamOrder 复制，之后独立
      currentTurnIdx:  0,    // 指向 r5.teamOrder 的下标（跳过已出局队）
      activeTeams:     [],   // 尚未出局的 teamId[]
      timerSec:        10,
      usedAnswers:     [],   // 本令题已用有效答案
      themeWinners:    [],   // 每令题擂主 teamId
      isTiebreak:      false,// 当前令题是否为并列加赛（只有并列队参加）
    },

    // ── 翻牌选题 ────────────────────────────────
    cardFlip: {
      enabled: true,
      rounds:  { 1: true, 2: true, 4: true },   // 哪些环节开启翻牌
      deckSize: { 1: 20, 2: 0 },        // 每环节翻牌张数（0 = 用全部可用题目）；R1 现在一张牌=一位选手的一轮（含多题），默认 20＝5队×4人；R4 按队伍数固定
      cards:   [],                      // CardItem[]
      context: {
        round:     null,
        teamId:    null,
        memberIdx: null,
        pickCount: 0,
        picked:    [],
      },
      flipPulse:       0,   // 自增，触发展示页动画
      lastFlippedCard: null,
    },

    // ── 单卡翻牌（R3/R5 出题前的等待态）──────────
    // R1/2/4 是「多张牌选一张出题」，R3/R5 题目本就按顺序/主持人选定出，
    // 不需要选牌，但仍要有「一张牌」的等待画面 + 点【出题】时的翻牌动画，
    // 与其余环节观感一致。round 标记这张牌属于哪个环节，避免残留状态串场。
    turnCard: { round: null, revealed: false },

    // ── 计时器 ──────────────────────────────────
    timer: {
      state:      'idle',   // idle|running|paused|expired
      durationMs: 0,
      startedAt:  null,     // Date.now() timestamp
      pausedAt:   null,
      elapsedMs:  0,        // 暂停前已过去的毫秒
      round:      null,     // 属于哪个环节
    },

    // ── 抽签 ────────────────────────────────────
    // 只抽出场顺序。第四环节的图题曾经也在这里预分配（r4ImageMap），
    // 现已改为翻牌当场随机抽（见 r4DrawForCard），故移除。
    draw: {
      teamOrder:  [],            // teamId[]，5支队伍出场顺序
      orderLocked: false,
      log:        [],            // {type,prev,result,operator,ts}
    },

    // ── 历史记录 ────────────────────────────────
    history: [],                 // ScoreEvent[]

    // ── 大屏展示控制 ────────────────────────────
    showScoresOnDisplay: false,
    showAnswerOnDisplay: false,
    // 选手所选的选项字母数组（如 ['B']）。大屏据此高亮：选对=绿、选错=红。
    // 揭晓正确答案（showAnswerOnDisplay）之前先只显示它，实现「先红后揭晓」的两段式。
    // 环节收尾小结：控制台点/自动触发时写入，大屏据此弹柱状图浮层；null=不显示
    // { round, rows:[{teamId,name,color,score,total}] }
    roundSummary: null,

    // 加/扣分动画信号：{teamId, delta, pulse}。pulse 每变一次，大屏在该队记分卡上
    // 飘一次 ±N 并闪一下。用计数器而非布尔，连续两次同样的扣分也能各触发一次动画。
    scorePulse: null,

    pickedAnswer: null,
    displayMode: 'question',     // question|scores|blank|cardflip|draw|turncard

    // ── TTS 配置 ────────────────────────────────
    tts: {
      enabled:        true,
      // 引擎：auto=本地服务可用则用，否则回退原生；native=强制浏览器原生；server=强制本地服务
      engine:         'auto',
      serverUrl:      'http://127.0.0.1:5231',
      serverVoice:    '',        // 空=用服务端默认音色
      lang:           'zh-CN',
      voiceName:      '',        // 空=系统默认（仅原生引擎）
      rate:           1.0,
      pitch:          1.0,
      volume:         1.0,
      autoRead:       true,      // 切题自动朗读
      readOptions: {
        readStem:     true,
        readOptions:  true,
        readAnswer:   false,
      },
      readCountdown:  true,
      countdownAt:    [10, 5, 3, 2, 1],
      scripts:        {},        // 自定义话术占位
    },
  };
}

// ── 状态实例 ──────────────────────────────────────
let state = defaultState();
const listeners = new Set();

// ── 工具函数 ──────────────────────────────────────
function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  const result = { ...target };
  for (const k of Object.keys(source)) {
    if (source[k] !== null && typeof source[k] === 'object' && !Array.isArray(source[k])
        && target[k] !== null && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      result[k] = deepMerge(target[k], source[k]);
    } else {
      result[k] = source[k];
    }
  }
  return result;
}

function fisherYates(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getTeam(id) { return state.teams.find(t => t.id === id); }
function getTeamByIdx(idx) {
  const order = state.draw.teamOrder;
  if (!order.length) return state.teams[idx] || null;
  return getTeam(order[idx]);
}
function teamColor(teamId) {
  const idx = state.teams.findIndex(t => t.id === teamId);
  return idx >= 0 ? TEAM_COLORS[idx % TEAM_COLORS.length] : '#888';
}
function teamTotal(team) {
  return Object.values(team.scores || {}).reduce((a, b) => a + (b || 0), 0);
}
function getRanking() {
  return [...state.teams]
    .map(t => ({ team: t, total: teamTotal(t) }))
    .sort((a, b) => b.total - a.total);
}

/**
 * 并列检测（赛制：若最终并列，以新令题加赛决胜）
 * rank: 检测第几名的并列，默认 1 = 冠军
 * 返回并列的队伍数组；长度 < 2 表示无并列，返回空数组。
 */
function hasTie(rank = 1) {
  const ranking = getRanking();
  if (ranking.length < rank) return [];
  const target = ranking[rank - 1].total;
  const tied = ranking.filter(r => r.total === target);
  return tied.length >= 2 ? tied.map(r => r.team) : [];
}

/** 全部并列组（用于赛后核对名次，返回 [{total, teams[]}]，仅含 >=2 队的组） */
function getTieGroups() {
  const byTotal = new Map();
  for (const { team, total } of getRanking()) {
    if (!byTotal.has(total)) byTotal.set(total, []);
    byTotal.get(total).push(team);
  }
  return [...byTotal.entries()]
    .filter(([, teams]) => teams.length >= 2)
    .map(([total, teams]) => ({ total, teams }));
}

/**
 * 统一加分入口：按环节上限裁剪后写入队伍分数（见第六章）
 * roundKey: 'r1'~'r5'。返回实际生效的分差。
 *
 * 裁剪规则：
 *   无上限环节（r3/r5，cap==null）—— 原样累加，可正可负
 *   有上限环节（r1/r2/r4）——
 *     加分：clamp 到 cap，封顶后多余部分丢弃，且不会因已超顶而倒扣
 *     扣分：【原样通过，不受上限约束】。处罚就是处罚，与队伍当前是否封顶无关；
 *           若在此处也套 Math.max(0, ...)，扣分会被静默吞掉（R1 违规扣 2 分即属此例）
 *
 * 注意：不 save()，由调用方负责。
 */
function applyTeamScore(teamId, roundKey, delta) {
  const team = getTeam(teamId);
  if (!team) return 0;
  const cap     = getScoreCfg(roundKey).cap;
  const current = team.scores[roundKey] || 0;
  let actual;
  if (cap == null || delta < 0) {
    actual = delta;                                    // 无上限环节 / 扣分：原样
  } else {
    actual = Math.max(0, Math.min(delta, cap - current));  // 加分：裁剪到上限
  }
  team.scores[roundKey] = current + actual;
  return actual;
}

/**
 * 第四环节：imageKey → 图片路径。
 *
 * 路径写在题库里（spot 题的 image 字段，相对 html 所在目录），不写就按
 * images/{imageKey}.png 的默认约定找。
 *
 * 早先这里支持在设置里上传图片、以 base64 存进 localStorage —— 已移除：
 * localStorage 每域名只有约 5MB，五张现场照片转 base64 就能撑爆，
 * 一旦写入失败连分数都存不进去。图片放进 images/ 目录既不占额度，
 * 换图也只是替换一个文件，比走界面上传更省事。
 */
function getR4ImageSrc(imageKey) {
  if (!imageKey) return null;
  const q = state.questions.find(x => x.type === 'spot' && x.imageKey === imageKey);
  return q?.image || `images/${imageKey}.png`;
}

// ── 找茬点坐标（大屏答对后在图上打标记用）──────────
// x/y 是相对图片显示尺寸的百分比（0~100），换屏幕/换分辨率都不用重标。

/** 取某张图上某个找茬点的坐标；未标注返回 null */
function getR4SpotPos(imageKey, spotKey) {
  return state.r4.spotPos?.[imageKey]?.[spotKey] || null;
}

function setR4SpotPos(imageKey, spotKey, x, y) {
  if (!state.r4.spotPos) state.r4.spotPos = {};
  if (!state.r4.spotPos[imageKey]) state.r4.spotPos[imageKey] = {};
  state.r4.spotPos[imageKey][spotKey] = {
    x: Math.round(Math.max(0, Math.min(100, x)) * 10) / 10,
    y: Math.round(Math.max(0, Math.min(100, y)) * 10) / 10,
  };
  save();
}

function clearR4SpotPos(imageKey, spotKey) {
  if (spotKey == null) delete state.r4.spotPos?.[imageKey];      // 整张图清空
  else if (state.r4.spotPos?.[imageKey]) delete state.r4.spotPos[imageKey][spotKey];
  save();
}

/** 这张图已标注了几个点（设置页提示用） */
function r4SpotPosCount(imageKey) {
  return Object.keys(state.r4.spotPos?.[imageKey] || {}).length;
}

// ── 持久化 ───────────────────────────────────────
// state.rev 是单调递增的版本号，每次 save() 自增，跨页面同步靠它判断新旧。
//
// 为什么必须有：BroadcastChannel / storage 的送达顺序不保证，而且对端页面收到
// 状态后，它自己的监听器可能又 save() 一次，把一份【比本地旧】的快照广播回来。
// 没有版本号时这份回声会直接整体覆盖本地状态 —— 实测现象是抢答刚进 armed
// 又被打回 reading，抢答器按下去毫无反应；两个控制台还会就此形成回声风暴，
// 互相广播到页面卡死。收到不比本地新的快照一律丢弃即可根治。
let _applyingRemote = false;

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const loaded = JSON.parse(raw);
    state = deepMerge(defaultState(), loaded);
  } catch(e) { console.warn('[rz] load failed', e); }
}

function save(broadcast = true) {
  state.rev = (state.rev || 0) + 1;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  // 正在应用远端快照时，监听器里顺带触发的 save 不再广播出去：
  // 那等于把刚收到的东西原样弹回对端，白白放大回声（有版本号后不会出错，但没必要）
  if (broadcast && bc && !_applyingRemote) {
    try { bc.postMessage({ type: 'state', state }); } catch(e) {}
  }
  listeners.forEach(fn => fn());
}

/** 应用来自其他页面的状态快照；旧的（rev 不大于本地）直接丢弃 */
function _applyRemoteState(incoming) {
  if (!incoming || typeof incoming !== 'object') return;
  if ((incoming.rev || 0) <= (state.rev || 0)) return;   // 过期回声，丢弃
  _applyingRemote = true;
  try {
    state = incoming;
    listeners.forEach(fn => fn());
  } finally {
    _applyingRemote = false;
  }
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── 跨窗口同步 ──────────────────────────────────
if (bc) {
  bc.addEventListener('message', e => {
    if (e.data?.type === 'state') _applyRemoteState(e.data.state);
  });
}
window.addEventListener('storage', e => {
  if (e.key === STORAGE_KEY && e.newValue) {
    try {
      _applyRemoteState(deepMerge(defaultState(), JSON.parse(e.newValue)));
    } catch(err) {}
  }
});

// =====================================================
// TTS 模块 (仅在控制台页面运行)
//
// 两条链路：
//   server —— POST {serverUrl}/api/speak 取音频，用 <audio> 播放（音质好）
//   native —— 浏览器 speechSynthesis（无服务时的兜底，比赛不会因此中断）
//
// engine='auto' 时按健康检查结果自动选择；服务中途挂掉会即时回退到 native。
// 所有异步结果都用 _speakSeq 做打断隔离：过期的音频不会覆盖新播报。
// =====================================================
let _ttsQueue = [];
let _ttsBusy  = false;
let _speakSeq = 0;          // 每次新播报自增；异步回来发现对不上就丢弃
let _audioEl  = null;       // 当前服务端音频
let _serverOk = false;      // 健康检查结果
let _serverInfo = null;     // {engine, mime, voices}
const _fetchCtls  = new Set();  // 进行中的 fetch 控制器，打断时全部 abort
const _audioCache = new Map();  // cacheKey → objectURL（倒计时数字等复用）
const _inflight   = new Map();  // cacheKey → Promise，同文本并发只发一次请求

function isTTSAvailable() {
  return !!window.IS_CONTROL && state.tts.enabled &&
         (_useServer() || 'speechSynthesis' in window);
}

function _useServer() {
  const mode = state.tts.engine || 'auto';
  if (mode === 'native') return false;
  if (mode === 'server') return true;
  return _serverOk;
}

function getVoice() {
  if (!state.tts.voiceName) return null;
  return speechSynthesis.getVoices().find(v => v.name === state.tts.voiceName) || null;
}

/** 探测本地 TTS 服务；返回 {ok, engine, voices}。engine='native' 时跳过 */
async function ttsCheckServer() {
  if ((state.tts.engine || 'auto') === 'native') { _serverOk = false; return { ok:false }; }
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const res = await fetch(`${state.tts.serverUrl}/api/health`, { signal: ctl.signal });
    clearTimeout(t);
    const info = await res.json();
    _serverOk   = !!info.ok;
    _serverInfo = info;
    return info;
  } catch (e) {
    _serverOk = false; _serverInfo = null;
    return { ok:false, error: String(e) };
  }
}

function ttsServerStatus() {
  return { ok: _serverOk, info: _serverInfo, using: _useServer() ? 'server' : 'native' };
}

/** 赛前预热：把固定话术 + 各队名播报提前合成好，消除首句 2 秒延迟 */
async function ttsPrewarm() {
  if (!_serverOk) return { ok:0, error:'本地 TTS 服务未连接' };
  const texts = [
    '开始抢答', '继续抢答', '下面开始出题', '擂台抢答环节结束',
    '时间到', '时间到，作答超时', '时间到，无人抢答',
    '时间到，请各队举板', '时间到，本队找茬结束', '开放补抢',
    ...Array.from({length:10}, (_,i) => String(i+1)),
  ];
  for (const t of state.teams) {
    texts.push(`${t.name}抢答成功，请答题`, `${t.name}，抢答违规，扣两分`, `${t.name}出局`);
  }
  try {
    const res = await fetch(`${state.tts.serverUrl}/api/prewarm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts, voice: state.tts.serverVoice || '', rate: state.tts.rate }),
    });
    return await res.json();
  } catch (e) {
    return { ok:0, error: String(e) };
  }
}

/** 打断一切正在进行的播报 */
function _cancelAll() {
  _speakSeq++;
  _ttsQueue = [];
  _ttsBusy  = false;
  for (const c of _fetchCtls) { try { c.abort(); } catch(e) {} }
  _fetchCtls.clear();
  if (_audioEl) { try { _audioEl.pause(); } catch(e) {} _audioEl = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

function _cacheKey(text) {
  return `${text}|${state.tts.serverVoice || ''}|${state.tts.rate}`;
}

/**
 * 向服务取音频，返回 objectURL；失败抛异常。
 * 三层去重：已缓存直接返回 → 同文本正在请求则复用该 Promise → 否则发新请求。
 */
// 单次合成请求的最长等待。超过就当服务不可用，回退浏览器原生语音。
// 为什么必须有：/api/speak 是同步阻塞接口，服务端一旦卡住（线程堆死、
// 引擎连不上外网）就永远不返回；没有超时的话前端会一直 await，
// 现场表现是「大屏出了题，然后再没有任何动静」，整场比赛就此停摆。
const TTS_FETCH_TIMEOUT_MS = 8000;

function _fetchAudio(text) {
  const key = _cacheKey(text);
  if (_audioCache.has(key)) return Promise.resolve(_audioCache.get(key));
  if (_inflight.has(key))   return _inflight.get(key);

  const ctl = new AbortController();
  _fetchCtls.add(ctl);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; try { ctl.abort(); } catch(e) {} },
                           TTS_FETCH_TIMEOUT_MS);
  const p = (async () => {
    try {
      const res = await fetch(`${state.tts.serverUrl}/api/speak`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text, voice: state.tts.serverVoice || '', rate: state.tts.rate }),
        signal:  ctl.signal,
      });
      if (!res.ok) throw new Error(`TTS 服务返回 ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      _audioCache.set(key, url);
      return url;
    } catch (e) {
      // 超时触发的 abort 必须换成普通异常抛出：调用方把 AbortError 当作
      // 「被新播报正常打断」而静默丢弃，超时若也报 AbortError 就不会回退原生语音
      if (timedOut) throw new Error(`TTS 服务 ${TTS_FETCH_TIMEOUT_MS / 1000} 秒无响应`);
      throw e;
    } finally {
      clearTimeout(timer);
      _inflight.delete(key);
      _fetchCtls.delete(ctl);
    }
  })();
  _inflight.set(key, p);
  return p;
}

/**
 * 并行预取多段音频。
 * 串行等合成会让读题前出现十几秒死寂（每段约 2.5 秒），
 * 这里一次性把所有段发出去，总等待收敛为最慢的那一段。
 */
function _prefetchAll(segments) {
  if (!_useServer()) return;
  for (const t of segments) {
    if (t) _fetchAudio(t).catch(() => {});   // 失败留给播放时回退处理
  }
}

/** 原生 Web Speech 播一段 */
function _nativeSpeak(text, onend, seq, opts = {}) {
  if (!('speechSynthesis' in window)) { onend?.(); return; }
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang   = state.tts.lang;
  utt.rate   = opts.rate   ?? state.tts.rate;
  utt.pitch  = opts.pitch  ?? state.tts.pitch;
  utt.volume = opts.volume ?? state.tts.volume;
  const voice = getVoice();
  if (voice) utt.voice = voice;
  utt.onend = () => { if (seq === _speakSeq) onend?.(); };
  speechSynthesis.speak(utt);
  // Chrome 长时间空置后可能停在 paused 静默状态，resume 兜底（见 12.11）
  try { speechSynthesis.resume(); } catch(e) {}
}

/** 服务端播一段；任何失败都回退原生，保证现场不哑火 */
async function _serverSpeak(text, onend, seq, opts = {}) {
  try {
    const url = await _fetchAudio(text);
    if (seq !== _speakSeq) return;              // 已被新播报打断，丢弃
    const a = new Audio(url);
    a.volume = opts.volume ?? state.tts.volume ?? 1;
    _audioEl = a;
    a.onended = () => { if (seq === _speakSeq) onend?.(); };
    a.onerror = () => {
      if (seq !== _speakSeq) return;
      _nativeSpeak(text, onend, seq, opts);     // 音频损坏 → 原生兜底
    };
    await a.play();
  } catch (e) {
    if (e?.name === 'AbortError' || seq !== _speakSeq) return;  // 正常打断，不算失败
    console.warn('[rz] 本地 TTS 失败，回退原生语音:', e.message);
    _serverOk = false;                          // 标记掉线，后续直接走原生
    _nativeSpeak(text, onend, seq, opts);
  }
}

/** 播一段（不打断，内部用） */
function _speakOne(text, onend, seq, opts) {
  if (_useServer()) _serverSpeak(text, onend, seq, opts);
  else              _nativeSpeak(text, onend, seq, opts);
}

/**
 * 给一次播报套上「到点必走」的看门狗，返回包装后的回调（只会触发一次）。
 *
 * 播报回调不来的情况在现场是真实存在的：TTS 服务卡死、Chrome 的
 * speechSynthesis onend 不回调、音频解码失败。这些回调是流程的推进器
 * （念完题才开抢、判分播完才出下一题），不来就整场停摆 —— 主持人站在台上
 * 只看到大屏出了题然后再没动静，也不知道该点什么。
 *
 * 宁可少念一句，也不能让环节卡住：按字数估个上限，到点就直接往下走。
 * 估算给得比正常朗读宽裕得多，正常播完总会先回调，看门狗只在真出事时兜底。
 * 必须在 _cancelAll() 之后调用 —— seq 要取新的那一个。
 */
function _withSpeechWatchdog(segments, cb) {
  const seq = _speakSeq;
  let done = false;
  const est = segments.reduce((a, t) => a + String(t || '').length * 300 + 1500, 0) + 4000;
  const timer = setTimeout(() => {
    if (done || seq !== _speakSeq) return;   // 已正常播完 / 已被新的播报接管
    done = true;
    console.warn('[rz] 朗读超时（TTS 无响应），跳过剩余语音继续流程');
    _ttsQueue = [];
    _ttsBusy  = false;
    cb?.();
  }, est);
  return () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    cb?.();
  };
}

/** 播放单条文本（立即打断当前播放） */
function speak(text, opts = {}) {
  if (!isTTSAvailable()) { opts.onend?.(); return; }
  _cancelAll();
  const seq = _speakSeq;
  _speakOne(text, _withSpeechWatchdog([text], opts.onend), seq, opts);
}

/**
 * 顺序播放多段文本；全部播完后调用 onAllDone。
 * onSegment(text) 在每一段【开始播之前】调用 —— 发令倒数要靠它把「现在念到几」
 * 同步到大屏的倒计时牌上，光有声音、屏上不动，远处的选手对不上拍子。
 * TTS 不可用时也会依次回调，保证屏上倒数不会因为静音就不走。
 */
function speakQueue(segments, onAllDone, onSegment) {
  if (!isTTSAvailable()) {
    if (onSegment) segments.forEach(t => onSegment(t));
    onAllDone?.();
    return;
  }
  _cancelAll();
  _ttsQueue = [...segments];
  _prefetchAll(_ttsQueue);          // 先并行发起全部合成，再顺序播放
  _drainQueue(_withSpeechWatchdog(_ttsQueue, onAllDone), _speakSeq, onSegment);
}

function _drainQueue(onAllDone, seq, onSegment) {
  if (seq !== _speakSeq) return;                       // 整个队列已被打断
  if (!_ttsQueue.length) { _ttsBusy = false; onAllDone?.(); return; }
  _ttsBusy = true;
  const text = _ttsQueue.shift();
  if (!text) { _drainQueue(onAllDone, seq, onSegment); return; }
  onSegment?.(text);
  _speakOne(text, () => _drainQueue(onAllDone, seq, onSegment), seq);
}

function stopSpeak() {
  _cancelAll();
}

// ── 抢答发令音「滴」──────────────────────────────
// 用 Web Audio 现场合成，不走音频文件、也不走 TTS 服务：发令音是全场抢答公平性的
// 基准，绝不能因为「文件没加载出来」或「TTS 服务掉线」而不响。
let _audioCtx = null;

function getBeepCfg() {
  const c = state.r3?.beep || {};
  const ms   = Number(c.ms);
  const gain = Number(c.gain);
  return {
    ms:   ms   > 0 ? Math.min(2000, ms)  : BEEP_DEFAULT.ms,
    gain: gain > 0 ? Math.min(1, gain)   : BEEP_DEFAULT.gain,
  };
}

/**
 * 播一声「滴」，播完（或兜底到点）回调 onDone。
 * onDone 保证只触发一次：osc.onended 在部分浏览器不回调，故另加保底定时器。
 *
 * 音色用【方波 + 低八度正弦】而不是单一正弦：同样振幅下方波谐波丰富、听感亮得多，
 * 在嘈杂会场里才穿得透；再叠一个低八度正弦补厚度，免得只有方波时又尖又薄。
 */
function playBuzzBeep(onDone) {
  const cfg = getBeepCfg();
  const DUR = cfg.ms / 1000;
  let fired = false;
  const fire = () => { if (!fired) { fired = true; onDone?.(); } };
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { setTimeout(fire, cfg.ms); return; }
    if (!_audioCtx) _audioCtx = new Ctx();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();

    const t0   = _audioCtx.currentTime;
    const bus  = _audioCtx.createGain();
    bus.connect(_audioCtx.destination);
    // 两端各留 12ms 渐变去掉「啪」的爆音，中间全程保持满音量，听感才够实
    bus.gain.setValueAtTime(0, t0);
    bus.gain.linearRampToValueAtTime(cfg.gain, t0 + 0.012);
    bus.gain.setValueAtTime(cfg.gain, t0 + Math.max(0.02, DUR - 0.02));
    bus.gain.linearRampToValueAtTime(0, t0 + DUR);

    const mk = (type, freq, level) => {
      const o = _audioCtx.createOscillator();
      const g = _audioCtx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(level, t0);
      o.connect(g).connect(bus);
      o.start(t0);
      o.stop(t0 + DUR);
      return o;
    };
    mk('square', 880, 0.55);          // 主音，亮、穿透力强
    const sub = mk('sine', 440, 0.45); // 低八度，补厚度
    sub.onended = fire;
    setTimeout(fire, cfg.ms + 150);   // 保底
  } catch (e) {
    console.warn('[rz] 发令音播放失败，按静音继续:', e?.message);
    setTimeout(fire, cfg.ms);
  }
}

/** 数字转中文语音（含小数） */
function scoreToSpeech(n) {
  if (n === 0) return '零分';
  const abs = Math.abs(n);
  const sign = n < 0 ? '负' : '';
  // 处理小数
  if (!Number.isInteger(abs)) {
    const parts = abs.toFixed(1).split('.');
    const intPart  = intToChinese(parseInt(parts[0]));
    const fracPart = parts[1] === '5' ? '点五' : `点${parts[1]}`;
    return `${sign}${intPart}${fracPart}分`;
  }
  return `${sign}${intToChinese(abs)}分`;
}

function intToChinese(n) {
  const nums = ['零','一','二','三','四','五','六','七','八','九','十'];
  if (n <= 10) return nums[n];
  if (n < 20)  return '十' + (n % 10 ? nums[n % 10] : '');
  if (n < 100) {
    const t = Math.floor(n / 10), u = n % 10;
    return nums[t] + '十' + (u ? nums[u] : '');
  }
  return String(n);
}

/**
 * 播报得分事件
 * event: { teamName, reason, delta }
 * reason: 'correct'|'partial'|'wrong'|'timeout'|'violation'|'spot'|'flower_valid'|'flower_winner'|'adjust'
 * 话术可用 state.tts.scripts[reason] 覆盖，模板支持 {team}/{score}/{delta} 占位符
 */
function announceScore(event, callback) {
  if (!isTTSAvailable()) { callback?.(); return; }
  const { teamName, reason, delta } = event;
  const custom = state.tts.scripts?.[reason];
  if (custom) {
    const text = custom
      .replace(/\{team\}/g, teamName ?? '')
      .replace(/\{score\}/g, scoreToSpeech(Math.abs(delta || 0)))
      .replace(/\{delta\}/g, String(delta ?? 0));
    speak(text, { onend: callback });
    return;
  }
  let text = '';
  if (reason === 'correct') {
    text = `${teamName}，答对，得到${scoreToSpeech(Math.abs(delta))}`;
  } else if (reason === 'partial') {
    text = `${teamName}，部分答对，得到${scoreToSpeech(Math.abs(delta))}`;
  } else if (reason === 'wrong') {
    text = `${teamName}，答错，${delta < 0 ? '扣' + scoreToSpeech(Math.abs(delta)) : '不得分'}`;
  } else if (reason === 'timeout') {
    text = `${teamName}，超时，不得分`;
  } else if (reason === 'violation') {
    text = `${teamName}，抢答违规，扣${scoreToSpeech(Math.abs(delta))}`;
  } else if (reason === 'spot') {
    text = `找对一处，得到一分`;
  } else if (reason === 'flower_valid') {
    text = `${teamName}，有效，得到一分`;
  } else if (reason === 'flower_winner') {
    text = `${teamName}，本题擂主，额外得到三分`;
  } else if (reason === 'adjust') {
    text = delta >= 0
      ? `已为${teamName}加${scoreToSpeech(Math.abs(delta))}`
      : `已为${teamName}扣${scoreToSpeech(Math.abs(delta))}`;
  }
  if (text) speak(text, { onend: callback });
  else callback?.();
}

/** 题干朗读处理：把填空的下划线（两个及以上，含全角）念成「什么」，
 *  避免 TTS 逐个读成"底线底线"。仅影响朗读，屏幕上题干仍显示下划线。 */
function stemForSpeech(stem) {
  return String(stem || '').replace(/[_＿]{2,}/g, '什么');
}

/** 将题目组装为 TTS 朗读片段 */
function buildQuestionSegments(q) {
  if (!q) return [];
  const segs = [];
  if (state.tts.readOptions?.readStem !== false) {
    segs.push(stemForSpeech(q.stem || ''));
  }
  if (state.tts.readOptions?.readOptions && q.options?.length) {
    q.options.forEach((opt, i) => {
      const letter = ['A','B','C','D','E'][i] || String(i+1);
      segs.push(`${letter}：${opt}`);
    });
  }
  return segs.filter(Boolean);
}

// =====================================================
// 计时器模块
// =====================================================

/** 启动计时器 */
function startTimer(durationMs, round = null) {
  state.timer = {
    state:      'running',
    durationMs,
    startedAt:  Date.now(),
    pausedAt:   null,
    elapsedMs:  0,
    round,
  };
  save();
}

/** 暂停计时器 */
function pauseTimer() {
  if (state.timer.state !== 'running') return;
  state.timer.elapsedMs += Date.now() - state.timer.startedAt;
  state.timer.pausedAt   = Date.now();
  state.timer.state      = 'paused';
  save();
}

/** 恢复计时器 */
function resumeTimer() {
  if (state.timer.state !== 'paused') return;
  state.timer.startedAt = Date.now();
  state.timer.pausedAt  = null;
  state.timer.state     = 'running';
  save();
}

/** 重置计时器 */
function resetTimer() {
  state.timer.state     = 'idle';
  state.timer.startedAt = null;
  state.timer.elapsedMs = 0;
  state.timer.pausedAt  = null;
  save();
}

/** 手动触发超时 */
function expireTimer() {
  state.timer.state = 'expired';
  save();
}

/** 获取剩余毫秒（两页面各自计算，不依赖同步值） */
function getRemainingMs() {
  const t = state.timer;
  if (t.state === 'idle' || t.state === 'expired') return 0;
  let elapsed = t.elapsedMs;
  if (t.state === 'running' && t.startedAt) {
    elapsed += Date.now() - t.startedAt;
  }
  return Math.max(0, t.durationMs - elapsed);
}

// =====================================================
// 抽签模块
// =====================================================

/** 抽取队伍出场顺序 */
function drawTeamOrder() {
  if (state.draw.orderLocked) return false;
  const ids = state.teams.map(t => t.id);
  state.draw.teamOrder = fisherYates(ids);
  state.draw.log.push({ type:'draw_order', result:[...state.draw.teamOrder], ts: Date.now() });
  save();
  return true;
}

/**
 * 手动设置出场顺序（线下抽签后录入 / 拖拽排序用）
 * newOrder: teamId[]，必须是全部队伍的一个排列
 * 与 forceOverrideTeamOrder 的区别：这是【锁定前】的正常录入路径，不需要操作人备注；
 * 锁定后拒绝改动（改动请走 forceOverrideTeamOrder 暗门）。
 * 返回 true=成功，false=已锁定或顺序不合法。
 */
function setTeamOrderManual(newOrder) {
  if (state.draw.orderLocked) return false;
  if (!Array.isArray(newOrder) || newOrder.length !== state.teams.length) return false;
  const ids   = state.teams.map(t => t.id).slice().sort((a, b) => a - b);
  const given = newOrder.slice().sort((a, b) => a - b);
  if (ids.join(',') !== given.join(',')) return false;   // 必须是全部队伍的排列，不多不少不重
  const prev = [...state.draw.teamOrder];
  state.draw.teamOrder = [...newOrder];
  state.draw.log.push({ type: 'set_order_manual', prev, result: [...newOrder], ts: Date.now() });
  save();
  return true;
}

/** 锁定出场顺序 */
function lockDrawOrder() {
  if (!state.draw.teamOrder.length) return false;
  state.draw.orderLocked = true;
  state.draw.log.push({ type:'lock_order', ts: Date.now() });
  save();
  return true;
}

/** 解锁出场顺序（赛前准备阶段可自由解锁重排；解锁后恢复拖拽） */
function unlockDrawOrder() {
  state.draw.orderLocked = false;
  state.draw.log.push({ type:'unlock_order', ts: Date.now() });
  save();
  return true;
}

/**
 * 强制覆盖出场顺序（隐藏暗门，需操作人备注）
 * newOrder: teamId[]（必须是全部5支队伍的排列）
 * operator: 操作人姓名/备注（不能为空）
 */
function forceOverrideTeamOrder(newOrder, operator) {
  if (!operator?.trim()) throw new Error('操作人备注不能为空');
  if (!Array.isArray(newOrder) || newOrder.length !== state.teams.length) {
    throw new Error('顺序数组长度不合法');
  }
  const ids = state.teams.map(t => t.id).sort();
  const given = [...newOrder].sort();
  if (ids.join(',') !== given.join(',')) throw new Error('队伍 ID 不匹配');
  const prev = [...state.draw.teamOrder];
  state.draw.teamOrder  = [...newOrder];
  state.draw.orderLocked = true; // 覆盖后自动重新锁定
  state.draw.log.push({
    type: 'force_override',
    prev,
    result: [...newOrder],
    operator: operator.trim(),
    ts: Date.now(),
  });
  save();
}

// =====================================================
// 翻牌选题模块
// =====================================================

/**
 * 初始化翻牌牌组
 * round: 1 或 4
 * 第一环节: 40张问题卡（从 questions 中筛选 r1 类型，随机排列）
 * 第四环节: N 张空白牌，翻开时才随机抽图（见 r4DrawForCard）
 */
/** 按配置的牌数截取牌池：deckSize<=0 或未配置 → 用全部；否则取前 n 张（不足则全用） */
function deckSlice(pool, round) {
  const n = state.cardFlip.deckSize?.[round];
  return (n && n > 0) ? pool.slice(0, n) : pool;
}
/** 设置某环节翻牌张数（0/空 = 用全部）。改完需重新生成牌组才生效。 */
function setDeckSize(round, n) {
  if (!state.cardFlip.deckSize) state.cardFlip.deckSize = {};
  const v = parseInt(n, 10);
  state.cardFlip.deckSize[round] = (isNaN(v) || v < 0) ? 0 : v;
  save();
}

// =====================================================
// 抽题池（R1/R2/R3 共用）
// =====================================================
// 题库是扁平的题型池，不预分配环节。各环节点「开始本环节」时按 roundCfg 随机抽，
// 抽走的记进 state.usedQIds —— 全场跨环节都不再抽到同一道题。
// spot/theme 带 round，是单独上传的题源，天然被 round==null 排除在池子外。

// =====================================================
// 第四环节的图题池（独立于上面的题型池）
// =====================================================
// 图题（type:'spot'）是单独上传的题源：一张场景图 + 一份找茬点答案。
// 不在赛前分配给某队 —— 轮到某队翻牌，翻开那一刻才从「本场还没用过的图」里
// 随机抽一张。图池可以多于队伍数（导入 8 张、只出 5 张），出几张由
// roundCfg[4].turns 配；抽走的记进 r4.usedQIds，同场不会有两队撞同一张图。

/** 题库里全部图题 */
function r4ImagePool() {
  return state.questions.filter(q => q.type === 'spot');
}

/** 本场还没被抽走的图题 */
function r4AvailableImages() {
  const used = new Set(state.r4.usedQIds || []);
  return r4ImagePool().filter(q => !used.has(q.id));
}

/**
 * 本环节要出几道图题（= 发几张牌）。
 * roundCfg[4].turns 为 0/未配 → 按队伍数（每队一张，赛制默认）。
 * 真正发几张还要受图池存量限制，见 initCardDeck(4)。
 */
function getR4ImageCount() {
  const n = parseInt(state.roundCfg?.[4]?.turns, 10);
  if (n > 0) return n;
  return state.draw.teamOrder.length || state.teams.length;
}

/**
 * 翻开某张牌 → 当场随机抽一张图定给它。
 *
 * 抽中的图写回 card.imageKey（大屏牌背和后续 confirmFlip 都读它），
 * 同时立刻记进 usedQIds 并切好 currentQIdx —— 中间不留「已翻开但还没定图」
 * 的空档，否则大屏会闪一下空白牌背。
 *
 * 已经定过图的牌直接返回原图（重复调用不会换题）。
 * 返回抽中的题目对象；图池已空返回 null（调用方须提示主持人）。
 */
function r4DrawForCard(cardId) {
  const card = state.cardFlip.cards.find(c => c.id === cardId);
  if (!card) return null;

  let q;
  if (card.imageKey) {
    q = state.questions.find(x => x.type === 'spot' && x.imageKey === card.imageKey);
  } else {
    const avail = r4AvailableImages();
    if (!avail.length) return null;
    q = avail[Math.floor(Math.random() * avail.length)];
    card.imageKey = q.imageKey;
    if (!state.r4.usedQIds) state.r4.usedQIds = [];
    state.r4.usedQIds.push(q.id);
    // 牌面内容变了，大屏靠 flipPulse 判断要不要重绘牌组，不自增就还是旧牌背
    state.cardFlip.flipPulse++;
  }
  if (!q) return null;

  const idx = state.questions.indexOf(q);
  state.r4.currentQIdx = idx >= 0 ? idx : null;
  state.r4.spotJudge   = {};     // 新图，评委勾选清零
  state.r4.extraSpots  = [];
  save();
  return q;
}

/** 环节配置（带兜底，防旧存档缺字段） */
function getRoundCfg(round) {
  const d = { 1: { turns: 20, perTurn: 3, types: ['judge','single','fill'] },
              2: { turns: 5,  perTurn: 4, types: ['multi','multi','fill_multi','fill_multi'] },
              3: { turns: 25, perTurn: 1, types: ['any'] } }[round]
           || { turns: 0, perTurn: 1, types: ['any'] };
  const c = state.roundCfg?.[round] || {};
  const perTurn = c.perTurn > 0 ? c.perTurn : d.perTurn;
  const types   = (c.types?.length ? c.types : d.types).slice(0, perTurn);
  while (types.length < perTurn) types.push('any');      // 配置短了补 any，不让抽题挂掉
  return { turns: c.turns ?? d.turns, perTurn, types };
}

/** 可随机抽取的题池（不含 spot/theme 这类单独上传的题源） */
function poolAll() {
  return state.questions.filter(q => q.round == null);
}

/** 池子里某题型还剩几道没被抽走（type='any' = 不限题型） */
function poolAvailable(type) {
  const used = new Set(state.usedQIds || []);
  return poolAll().filter(q => !used.has(q.id) && (type === 'any' || q.type === type));
}

/**
 * 按题型清单抽一组题，返回 id 数组；任一题型无题可抽则返回 null（调用方须处理）。
 * exclude: 本次调用内已占用的 id（同一轮里避免重复抽到同一道）
 */
function drawQuestionIds(types, exclude = new Set()) {
  const picked = [];
  for (const t of types) {
    const avail = poolAvailable(t).filter(q => !exclude.has(q.id) && !picked.includes(q.id));
    if (!avail.length) return null;
    const q = avail[Math.floor(Math.random() * avail.length)];
    picked.push(q.id);
  }
  return picked;
}

// ── 擂台抢答的抽题（题型可多选）──────────────────
// R3 是一题一抽，没有「第 1 题、第 2 题」的顺序概念，所以不像 R1/R2 那样
// 逐题指定题型，而是配一个【允许的题型集合】，每次从集合里随机抽一道。

/**
 * 允许抽的题型集合。取值优先级：
 *   1. typePool —— 新配置，用户在设置里勾的
 *   2. types    —— 旧存档遗留（以前 R3 也走「逐题指定题型」那套，实际只有一格）。
 *                  没有 typePool 时把它当允许集合用，免得升级后主持人赛前配的
 *                  「只出判断题」被悄悄换成不限题型。'any' 不是具体题型，过滤掉。
 *   3. 全部题型 —— 都没有就是不限，与升级前 'any' 的行为一致
 * 用户一旦在设置里动过勾选，setR3Type() 会删掉遗留的 types，迁移只发生一次。
 */
function getR3TypePool() {
  const cfg = state.roundCfg?.[3] || {};
  const pick = arr => Array.isArray(arr) ? [...new Set(arr.filter(t => POOL_TYPES.includes(t)))] : [];
  const fromPool   = pick(cfg.typePool);
  if (fromPool.length) return fromPool;
  const fromLegacy = pick(cfg.types);
  if (fromLegacy.length) return fromLegacy;
  return [...POOL_TYPES];
}

/**
 * 当前还能抽的题：题型在允许集合内，且没被全场抽走。
 * 注意是【先合并候选、再随机】，不是「先随机选个题型、再从中抽题」——
 * 后者会让只剩 3 道的判断题和还剩 80 道的多选题被抽中的概率一样大，
 * 结果是稀缺题型很快见底、整个环节抽题失败。
 */
function r3AvailablePool() {
  const used  = new Set(state.usedQIds || []);
  const allow = new Set(getR3TypePool());
  return poolAll().filter(q => !used.has(q.id) && allow.has(q.type));
}

/** 随机抽一道抢答题，返回题目 id；抽不出返回 null */
function drawR3QuestionId() {
  const avail = r3AvailablePool();
  if (!avail.length) return null;
  return avail[Math.floor(Math.random() * avail.length)].id;
}

/** 把题目标记为已抽走（全场不再重复） */
function markQIdsUsed(qIds) {
  if (!state.usedQIds) state.usedQIds = [];
  for (const id of qIds) if (!state.usedQIds.includes(id)) state.usedQIds.push(id);
}

/**
 * 释放当前牌组里【还没翻过】的牌所预定的题，让它们回到池子。
 *
 * 为什么需要：建牌组时就把题标记成已用（"预定"），否则 R1 的牌还没翻完、
 * R3 出题就可能抽到躺在 R1 牌里的同一道题。但环节结束/重置牌组时，
 * 那些始终没被翻开的牌其实一道题都没问过，必须还回池子，不然题库白白损耗。
 */
function releaseUnplayedCards() {
  const cards = state.cardFlip.cards || [];
  if (!cards.length || !state.usedQIds?.length) return;
  const release = new Set();
  for (const c of cards) {
    if (c.used) continue;                  // 翻过并确认使用了 → 题已问出，保持占用
    (c.qIds || []).forEach(id => release.add(id));
  }
  if (!release.size) return;
  state.usedQIds = state.usedQIds.filter(id => !release.has(id));
}

/** 按当前配置，池子最多还能撑起几轮（受最紧缺的那个题型限制） */
function maxTurnsFor(round) {
  // R3 一题一抽，能出几题就是允许题型里还剩几道，不存在「每轮用量」
  if (round === 3) return r3AvailablePool().length;
  const { types } = getRoundCfg(round);
  const uses = {};
  types.forEach(t => { uses[t] = (uses[t] || 0) + 1; });
  let maxN = Infinity;
  for (const t of Object.keys(uses)) {
    maxN = Math.min(maxN, Math.floor(poolAvailable(t).length / uses[t]));
  }
  return isFinite(maxN) ? maxN : 0;
}

function initCardDeck(round) {
  if (!state.cardFlip.rounds[round]) return false;
  let cards = [];
  // 说明：下方任一分支都可能因「题库未导入」或「R4 未分配图」而产出空牌组。
  // 空牌组必须【在改动 state 之前】就返回 false —— 否则会造出
  // displayMode='cardflip' 但 cards=[] 的矛盾状态，大屏会静默掉回"等待出题"，
  // 主持人在台上完全不知道发生了什么。见函数末尾的守卫。
  if (round === 1 || round === 2) {
    // 一张牌＝一位选手/一支队伍连续作答的一整轮，每轮按 roundCfg[round].types 逐题抽。
    // 现在从「扁平题型池」里随机抽（不再按 round 过滤），抽走的立刻记进 usedQIds，
    // 全场跨环节都不会再抽到同一道题。
    releaseUnplayedCards();   // 旧牌组里没翻过的题先还回池子，避免重置牌组白耗题库
    const { turns, types } = getRoundCfg(round);
    // R2 是每队一张牌，张数由队伍数决定，不受 turns 配置影响
    const want = round === 2
      ? (state.draw.teamOrder.length || state.teams.length)
      : (turns > 0 ? turns : maxTurnsFor(round));
    const taken = new Set();           // 本次建牌已占用的题，避免同一副牌里重复
    for (let i = 0; i < want; i++) {
      const qIds = drawQuestionIds(types, taken);
      if (!qIds) break;                // 池子不够了，能发几张就发几张（调用方会提示）
      qIds.forEach(id => taken.add(id));
      cards.push({ id: `r${round}_${i}`, cardNum: i + 1, qIds, revealed: false, used: false });
    }
  } else if (round === 4) {
    // 牌【不预绑图】：发的是一叠空白牌，翻开哪张才现抽哪张图（r4DrawForCard）。
    // 张数取配置值，但不能超过图池存量 —— 发出去却抽不到图的牌是废牌，
    // 翻到它只会得到一句「图已用完」，等于当众卡壳。
    const want  = getR4ImageCount();
    const avail = r4AvailableImages().length;
    const n     = Math.min(want, avail);
    cards = Array.from({ length: n }, (_, i) => ({
      id:       `r4_${i}`,
      cardNum:  i + 1,
      imageKey: null,      // 翻开时才填
      revealed: false,
      used:     false,
    }));
  }

  // 守卫：牌组为空就不进入翻牌模式，且【不改动任何 state】。
  // 调用方必须检查返回值并给出可操作的提示（见 index.html 各 rxInit）。
  if (!cards.length) return false;

  // 预定这副牌用到的题，防止别的环节抽到同一道（没翻的牌之后会被 releaseUnplayedCards 还回去）
  cards.forEach(c => markQIdsUsed(c.qIds || []));

  state.cardFlip.cards = cards;
  state.cardFlip.context = {
    round,
    teamId:    null,
    memberIdx: null,
    pickCount: 0,
    picked:    [],
  };
  state.cardFlip.flipPulse       = 0;
  state.cardFlip.lastFlippedCard = null;
  state.displayMode = 'cardflip';
  save();
  return true;
}

/**
 * 某环节可用的题目数（翻牌与出题的前置条件）
 * R1/R2/R3 从扁平题型池里抽 → 看池子里还剩多少可用；
 * R4/R5 是单独上传的题源 → 仍按 round 计数。
 */
function countQuestions(round) {
  if (round >= 1 && round <= 3) return poolAvailable('any').length;
  return state.questions.filter(q => q.round === round).length;
}

/** 选手选牌（翻开某张） */
function selectCard(cardId) {
  const card = state.cardFlip.cards.find(c => c.id === cardId);
  if (!card || card.revealed || card.used) return false;
  card.revealed = true;
  state.cardFlip.lastFlippedCard = { ...card };
  state.cardFlip.flipPulse++;
  state.cardFlip.context.picked.push(cardId);
  state.cardFlip.context.pickCount++;
  save();
  return card;
}

/** 确认使用当前翻开的牌，激活对应题目 */
function confirmFlip(cardId) {
  const card = state.cardFlip.cards.find(c => c.id === cardId);
  if (!card || !card.revealed) return false;
  card.used = true;
  const round = state.cardFlip.context.round;
  if (round === 1 && card.qIds?.length) {
    state.r1.turnQIds   = card.qIds;
    state.r1.turnSubIdx = 0;
    const idx = state.questions.findIndex(q => q.id === card.qIds[0]);
    state.r1.currentQIdx = idx >= 0 ? idx : null;
  } else if (round === 2 && card.qIds?.length) {
    // R2 现在也是一张牌绑一整轮的题（每队各抽一组，不再全场共用同一组）
    state.r2.turnQIdxs = card.qIds
      .map(id => state.questions.findIndex(q => q.id === id))
      .filter(i => i >= 0);
    state.r2.qNum        = 0;
    state.r2.turnResults = [];
    state.r2.currentQIdx = state.r2.turnQIdxs.length ? state.r2.turnQIdxs[0] : null;
  } else if (round === 4) {
    // 图在翻开时已由 r4DrawForCard 抽定并写好 currentQIdx，这里只兜底：
    // 万一走到这还没图（例如图池空了），按牌上的 imageKey 再找一次。
    if (state.r4.currentQIdx == null && card.imageKey != null) {
      const idx = state.questions.findIndex(q => q.imageKey === card.imageKey);
      if (idx >= 0) state.r4.currentQIdx = idx;
    }
  }
  state.displayMode = 'question';
  save();
  return true;
}

/** 获取所有未翻、未用的牌 */
function getAvailableCards() {
  return state.cardFlip.cards.filter(c => !c.revealed && !c.used);
}

// =====================================================
// 第一环节 — 个人必答
// =====================================================

/**
 * 初始化第一环节
 */
function initR1() {
  state.currentRound = 1;
  state.roundPhase   = 'running';
  state.r1.currentTeamIdx   = 0;
  state.r1.currentMemberIdx = 0;
  state.r1.currentQIdx      = null;
  state.r1.usedQIds         = [];
  state.r1.turnQIds         = [];
  state.r1.turnSubIdx       = 0;
  state.pickedAnswer         = null;
  state.showAnswerOnDisplay  = false;
  state.showScoresOnDisplay  = false;
  resetTimer();
  save();
}

/**
 * 设置当前答题人
 */
function r1SetAnswerer(teamIdx, memberIdx) {
  state.r1.currentTeamIdx   = teamIdx;
  state.r1.currentMemberIdx = memberIdx;
  save();
}

/**
 * 为第一环节当前选手评分
 *
 * result: true = 答对 | false = 答错/超时 | 'violation' = 违规（队内外提示）
 *   答对   → +q.score_correct（兜底 2.5），走上限裁剪
 *   答错   → 0 分，不扣分
 *   违规   → 本题 0 分【且】队伍扣 R1_VIOLATION_PENALTY（见 4.1 赛制）
 * note: 可选文字说明（违规/裁定的缘由），写入 ScoreEvent.note
 *
 * 兼容：旧调用 scoreR1(true) / scoreR1(false) 行为不变。
 */
function scoreR1(result, note = '') {
  const team = getTeamByIdx(state.r1.currentTeamIdx);
  if (!team) return null;
  const memberIdx = state.r1.currentMemberIdx;
  const qIdx      = state.r1.currentQIdx;
  const q         = qIdx != null ? state.questions[qIdx] : null;
  const baseScore = getScoreCfg('r1').correct;   // 分值按环节配置，不读题库

  const isViolation = result === 'violation';
  const correct     = result === true;
  // 违规：本题不得分，另扣队伍分（个人分不扣——处罚记在队伍头上，见 4.1）
  const delta       = correct ? baseScore : (isViolation ? R1_VIOLATION_PENALTY : 0);

  // 队伍分走上限裁剪；个人分记裁剪【前】的真实得分。
  // 二者解耦的原因：R1 满分 20 = 4人×2题×2.5分，全队全对必然触顶，
  // 若个人分也跟着裁剪，恰恰是表现最好的队伍评不出「最佳个人」。
  const actual = applyTeamScore(team.id, 'r1', delta);
  // 违规扣的是队伍分，个人分只记该题本身的得分（0），不跟着倒扣
  const memberDelta = isViolation ? 0 : delta;
  team.memberScores[memberIdx] = (team.memberScores[memberIdx] || 0) + memberDelta;

  const event = {
    round:      1,
    teamId:     team.id,
    teamName:   team.name,
    memberIdx,
    memberName: team.members[memberIdx],
    correct,
    delta:      actual,        // 队伍实际入账（裁剪后）
    memberDelta,               // 个人实际入账；封顶或违规时与 delta 不等
    capped:     delta !== actual,
    reason:     correct ? 'correct' : (isViolation ? 'violation' : 'wrong'),
    qId:        q?.id,
    ts:         Date.now(),
  };
  if (note) event.note = note;
  // skipAnnounce：doR1() 随后会播一句更完整的（含队员名、总分、封顶说明）。
  // 不跳过的话这里先播一句通用话术，紧接着被 doR1 的 speak 打断，白白抢一次麦。
  logEvent(event, true);
  return event;
}

// =====================================================
// 第二环节 — 团队共答
// =====================================================

function initR2() {
  state.currentRound = 2;
  state.roundPhase   = 'running';
  state.r2.currentTeamIdx   = 0;
  state.r2.currentMemberIdx = null;   // 每题必须手动选队员，默认不选
  state.r2.turnQIdxs        = [];
  state.r2.qNum             = 0;
  state.r2.turnResults      = [];
  state.r2.currentQIdx      = null;
  state.r2.usedQIds         = [];
  state.pickedAnswer         = null;
  state.showAnswerOnDisplay = false;
  state.showScoresOnDisplay = false;
  resetTimer();
  save();
}

// 本队这一轮要答哪几题，已由 confirmFlip() 从翻开的那张牌上装载（每队各抽一组，
// 不再全场共用同一组题）。原先的 r2QuestionIdxs()/r2StartTurn() 按 round===2 过滤题库，
// 在「扁平题型池」模型下已无意义，故删除。

/**
 * 给当前上场队的本题判分（只记队伍分，队员不计分）。
 * correct=true → +q.score_correct（兜底 5，走上限裁剪）；false → 0 分。
 * 结果推入 turnResults，供整轮小结播报。返回 ScoreEvent。
 */
function r2ScoreCurrent(correct) {
  const teamId = state.draw.teamOrder[state.r2.currentTeamIdx];
  const team   = getTeam(teamId);
  if (!team) return null;
  const qIdx = state.r2.currentQIdx;
  const q    = qIdx != null ? state.questions[qIdx] : null;
  const delta  = correct ? getScoreCfg('r2').correct : 0;   // 分值按环节配置，不读题库
  const actual = applyTeamScore(teamId, 'r2', delta);
  const mIdx = state.r2.currentMemberIdx;
  const event = {
    round: 2, teamId, teamName: team.name,
    memberIdx: mIdx,
    memberName: (mIdx != null ? team.members[mIdx] : '') || '',
    correct, delta: actual, capped: delta !== actual,
    reason: correct ? 'correct' : 'wrong',
    qId: q?.id, ts: Date.now(),
  };
  logEvent(event, true);   // skipAnnounce：doR2() 随后播更完整的一句，同 R1
  (state.r2.turnResults = state.r2.turnResults || []).push({ correct, delta: actual });
  return event;
}

/**
 * 多选题评分（含错选=0分规则）
 * teamId: 队伍 id
 * selected: string[] 选中的选项
 * correct: string[] 正确选项集合
 * totalScore: 本题满分（默认5分）
 */
function scoreR2Multi(teamId, selected, correctOptions, totalScore = null) {
  const team = getTeam(teamId);
  if (!team) return null;
  totalScore = totalScore ?? getScoreCfg('r2').correct;   // 不传就用环节配置的每题分
  const q = state.r2.currentQIdx != null ? state.questions[state.r2.currentQIdx] : null;

  // 含任一错选则0分
  const selSet  = new Set(selected);
  const corrSet = new Set(correctOptions);
  let delta = 0;
  let hasWrong = false;
  for (const s of selSet) {
    if (!corrSet.has(s)) { hasWrong = true; break; }
  }
  if (!hasWrong && selSet.size > 0) {
    // 按正确选项数均分
    delta = (selSet.size / corrSet.size) * totalScore;
  }
  const actual = applyTeamScore(team.id, 'r2', Math.round(delta * 100) / 100);

  const fullCorrect = !hasWrong && selSet.size === corrSet.size;
  const event = {
    round: 2, teamId: team.id, teamName: team.name,
    correct: fullCorrect,
    delta: actual,
    reason: fullCorrect ? 'correct' : (actual > 0 ? 'partial' : 'wrong'),
    qId: q?.id, ts: Date.now(),
  };
  logEvent(event);
  return event;
}

/**
 * 多项填空题评分（按空均分，逐空独立匹配）
 * blanks: { key: string }[] 每个空的作答
 * correctBlanks: { key: string }[] 每个空的正确答案
 * totalScore: 本题满分（默认5分）
 */
function scoreR2FillMulti(teamId, blanks, correctBlanks, totalScore = null) {
  const team = getTeam(teamId);
  if (!team) return null;
  totalScore = totalScore ?? getScoreCfg('r2').correct;   // 不传就用环节配置的每题分
  const q      = state.r2.currentQIdx != null ? state.questions[state.r2.currentQIdx] : null;
  const perBlank = totalScore / correctBlanks.length;
  let correct = 0;
  correctBlanks.forEach((ans, i) => {
    const given = (blanks[i] || '').trim();
    const expected = Array.isArray(ans) ? ans : [ans];
    if (expected.some(e => e.trim() === given)) correct++;
  });
  const delta  = Math.round(correct * perBlank * 100) / 100;
  const actual = applyTeamScore(team.id, 'r2', delta);

  const fullCorrect = correct === correctBlanks.length;
  const event = {
    round: 2, teamId: team.id, teamName: team.name,
    correct: fullCorrect,
    delta: actual,
    reason: fullCorrect ? 'correct' : (actual > 0 ? 'partial' : 'wrong'),
    qId: q?.id, ts: Date.now(),
  };
  logEvent(event);
  return event;
}

// =====================================================
// 第三环节 — 擂台抢答
// =====================================================

function initR3() {
  state.currentRound = 3;
  state.roundPhase   = 'running';
  state.r3.currentQIdx     = null;
  state.r3.usedQIds        = [];
  state.r3.buzzState       = 'idle';
  state.r3.buzzedTeam      = null;
  state.r3.selectedTeam    = null;
  state.r3.selectedMember  = null;
  state.r3.buzzPulse       = 0;
  state.r3.excludedTeams   = [];
  state.r3.violatedTeams   = [];
  state.r3.currentReadText = '';
  state.showAnswerOnDisplay = false;
  state.showScoresOnDisplay = false;
  state.turnCard = { round: 3, revealed: false };
  state.displayMode = 'turncard';
  resetTimer();
  save();
}

/**
 * 出题：开始读题（TTS），读完后自动进入 armed 状态
 * qIdx: questions[] 中的索引
 * onArmed: callback，TTS 读完"开始抢答"后调用
 *
 * 抢答状态机（三段，按赛制定的）：
 *   reading   正在念题干/选项 —— 按抢答器【完全忽略】，不扣分、不打断，
 *             选手还没听完题就按纯属手滑或设备抖动，罚了不公平
 *   prearm    题已念完、正在念「开始抢答」的空档 —— 按抢答器【判违规扣分】，
 *             这一段才是真正的抢跑，防的就是听完题就疯狂砸按钮
 *   armed     「开始抢答」念完 —— 第一个按下的锁定
 */
function r3StartQuestion(qIdx, onArmed, intro = '') {
  const q = state.questions[qIdx];
  if (!q) return false;
  state.r3.currentQIdx     = qIdx;
  state.r3.buzzState       = 'reading';
  state.r3.goCount         = null;
  state.r3.buzzedTeam      = null;
  state.r3.selectedTeam    = null;
  state.r3.selectedMember  = null;
  state.r3.excludedTeams   = [];   // 新题，重新允许所有队伍抢答
  state.r3.violatedTeams   = [];   // 新题，违规记录清零（同一队同一题只罚一次）
  state.r3.currentReadText = q.stem || '';
  state.showAnswerOnDisplay = false;
  // 必须清掉上一环节残留的所选：大屏对「被选中且正好是正确答案」的选项会直接标绿，
  // 不看 showAnswerOnDisplay。残留值万一与本题答案相同，等于开局就泄题。
  state.pickedAnswer = null;
  save();

  if (window.IS_CONTROL) {
    // 分两段播：报题+题干/选项一段，发令口令单独一段 —— 中间那一刻切到 prearm，
    // 抢跑判定窗口就精确地落在「题念完 → 发令落地」之间。
    // intro 是「第三题，判断题」这类报题前缀，格式与 R1/R2 一致，由调用方拼好传进来
    // （题型中文名是控制台侧的显示文案，不下沉到状态层）。
    speakQueue([intro, ...buildQuestionSegments(q)].filter(Boolean), () => {
      state.r3.buzzState = 'prearm';
      save();
      r3SpeakGoAndArm(onArmed);
    });
  } else {
    onArmed?.();
  }
  return true;
}

/**
 * 念发令口令，念完进 armed 并起计时。违规播报结束后也走这里（不重读整题）。
 *
 * 两种发令方式：
 *   系统读题开启 —— 「开始抢答」→ 三 → 二 → 一 → 滴。【滴响的那一刻】才 armed，
 *                    3、2、1 全程仍是 prearm，此间抢按＝抢跑违规（见 r3TryBuzz）。
 *                    倒数把发令时刻钉死在一个所有人都听得见的点上，比一句话念完
 *                    含糊收尾要公平得多。
 *   手动模式     —— 沿用原样：「开始抢答」念完即开抢。
 */
function r3SpeakGoAndArm(onArmed, cue = '开始抢答') {
  const arm = () => {
    if (state.r3.currentQIdx == null) return;   // 期间已跳过本题
    state.r3.buzzState = 'armed';
    // goCount===0 表示「滴」正显示在倒计时牌上，别在这里抹掉 —— 开抢与滴声同刻发生，
    // 抹了牌面就永远闪不出那个「滴」。由下面的定时器过 600ms 交回答题倒计时。
    if (state.r3.goCount !== 0) state.r3.goCount = null;
    save();
    onArmed?.();
    startTimer(state.r3.timerSec * 1000, 3);
  };
  if (!window.IS_CONTROL) { arm(); return; }
  if (state.r3.autoRead) {
    // 用阿拉伯数字而非「三二一」：预热缓存里存的就是 '1'~'10'，能直接命中，不必现合成
    speakQueue([cue, '3', '2', '1'], () => {
      state.r3.goCount = 0;   // 0 = 正在响「滴」，大屏据此把牌面切成绿色的「滴」
      // ⚠️ 必须在滴声【响起的同一刻】开抢，不能等它播完。
      // 滴声就是发令枪：选手听到就按。之前写成 playBuzzBeep(arm)，arm 是播完
      // 才触发的回调 —— 那 450ms 里状态还是 prearm，谁跟着滴声按谁被判抢跑违规。
      arm();
      playBuzzBeep();         // 声音自己播完即可，流程不等它
      // 「滴」在牌上留 600ms 再交回答题倒计时。只清自己那一次，
      // 期间若已换题/重置（goCount 被别处改过）就不动，免得抹掉新状态。
      setTimeout(() => {
        if (state.r3.goCount === 0) { state.r3.goCount = null; save(); }
      }, 600);
    }, seg => {
      // 把「现在念到几」同步到大屏倒计时牌：口令那段不是数字，牌面先清空待命
      const n = parseInt(seg, 10);
      state.r3.goCount = Number.isFinite(n) ? n : null;
      save();
    });
  } else {
    speak(cue, { onend: arm });
  }
}

/**
 * 尝试抢答（在 reading 状态按下 = 违规；armed 状态按下 = 成功）
 */
function r3TryBuzz(teamId, onViolationDone) {
  // 念题正文期间：完全忽略，不扣分、不打断朗读
  if (state.r3.buzzState === 'reading') return false;
  // 违规播报进行中：忽略，否则按住不放会连扣
  if (state.r3.buzzState === 'violating') return false;
  // 题念完、口令还没念完 → 抢跑违规
  if (state.r3.buzzState === 'prearm') {
    return r3EarlyBuzz(teamId, onViolationDone);
  }
  if (state.r3.buzzState !== 'armed') return false;
  if ((state.r3.excludedTeams || []).includes(teamId)) return false;   // 本题已抢答过，不能再抢
  const team = getTeam(teamId);
  if (!team) return false;
  state.r3.buzzState      = 'locked';
  state.r3.buzzedTeam     = teamId;
  state.r3.selectedTeam   = teamId;
  // 预选第一名队员，而不是留空。留空时选项不可点、判分按钮也是灰的，
  // 操作员必须先找到队员按钮点一下才能判分 —— 而队伍抢到后是【先口头作答】，
  // 操作员往往这时才知道是谁在答，被这一步卡住的同时 15 秒答题倒计时还在跑。
  // 预选后判分链路立即可用，答完再改选人即可（个人分按最终选中的人记）。
  state.r3.selectedMember = 0;
  state.r3.buzzPulse      = (state.r3.buzzPulse || 0) + 1;
  state.r3.lastBuzzTeam   = teamId;
  // 抢答成功改在记分牌上体现（大屏不再往题目上盖横幅，免得挡住抢到的队看题），
  // 所以这里必须把记分牌亮出来，否则「谁抢到了」全场没有任何提示
  state.showScoresOnDisplay = true;
  // 抢答窗口计时结束，重启 15 秒答题倒计时（见 4.3）
  startTimer(state.r3.timerSec * 1000, 3);

  if (window.IS_CONTROL) {
    speak(`${team.name}抢答成功，请答题`);
  }
  return true;
}

/**
 * 抢跑违规：题已念完、「开始抢答」口令还没念完就按了抢答器。
 *
 * 两条防连扣的措施（此前按住不放会被键盘自动重复反复触发，实测连按 5 次扣了 10 分）：
 *   1. 进入 'violating' 状态，播报期间的按键一律忽略
 *   2. violatedTeams 记账，同一队同一题只罚一次
 * 违规播完不重读整题（题本来就已经念完了），只重念一次「开始抢答」再开抢。
 */
function r3EarlyBuzz(teamId, onDone) {
  const team = getTeam(teamId);
  if (!team) return false;
  if (!state.r3.violatedTeams) state.r3.violatedTeams = [];
  if (state.r3.violatedTeams.includes(teamId)) return false;   // 本题已罚过，不重复扣
  state.r3.violatedTeams.push(teamId);

  if (window.IS_CONTROL) stopSpeak();          // 掐掉正在念的「开始抢答」
  state.r3.buzzState = 'violating';            // 播报期间按键无效
  // 扣分：违规是行为处罚，用固定常量，不读题库分值
  const delta = applyTeamScore(team.id, 'r3', R3_VIOLATION_PENALTY);
  // 抢跑还要没收本题的抢答资格（与答错后不能再抢同一套机制）
  if (!state.r3.excludedTeams) state.r3.excludedTeams = [];
  if (!state.r3.excludedTeams.includes(teamId)) state.r3.excludedTeams.push(teamId);

  logEvent({
    round: 3, teamId: team.id, teamName: team.name,
    correct: false, delta, reason: 'violation',
    note: '抢答口令前抢按，本题失去抢答资格', ts: Date.now(),
  }, true); // skipAnnounce：下面自己播

  // 大屏：亮出记分牌，并给该队打一个扣分动画的信号（pulse 变化即触发一次动画）
  state.showScoresOnDisplay = true;
  state.scorePulse = { teamId: team.id, delta, pulse: (state.scorePulse?.pulse || 0) + 1 };
  save();

  const resume = () => {
    state.r3.buzzState = 'prearm';   // 回到抢跑判定窗口，重新发一次令
    save();
    // 口令交给 r3SpeakGoAndArm 念（它后面还要接 3、2、1、滴），
    // 这里不能自己先念一遍「继续抢答」，否则会连着念两句口令
    r3SpeakGoAndArm(onDone, '继续抢答');
  };
  if (window.IS_CONTROL) {
    speakQueue([`${team.name}抢答违规，扣${scoreToSpeech(Math.abs(delta))}，本题失去抢答资格`], resume);
  } else {
    resume();
  }
  return true;
}

/**
 * 第三环节判分
 * correct: boolean
 */
function r3Score(correct) {
  const teamId    = state.r3.selectedTeam;
  const memberIdx = state.r3.selectedMember;
  const team      = getTeam(teamId);
  if (!team || memberIdx == null) return null;

  // 分值读题库配置，兜底 ±2（见 16.1 第 2 项）
  const q     = state.r3.currentQIdx != null ? state.questions[state.r3.currentQIdx] : null;
  const sc3   = getScoreCfg('r3');                          // 分值按环节配置，不读题库
  const nominal = correct ? sc3.correct : sc3.wrong;
  const delta   = applyTeamScore(team.id, 'r3', nominal);   // 取实际入账（配了封顶时与名义值不等）
  team.memberScores[memberIdx] = (team.memberScores[memberIdx] || 0) + delta;
  const event = {
    round: 3, teamId: team.id, teamName: team.name,
    memberIdx, memberName: team.members[memberIdx],
    correct, delta, reason: correct ? 'correct' : 'wrong',
    qId: q?.id,
    fromBuzz: true, ts: Date.now(),
  };
  // skipAnnounce：doR3() 随后播更完整的一句（含队员名、失去资格、总分）。
  // 不跳过的话这里先播一句通用话术，紧接着被 doR3 的 speak 打断，白抢一次麦。
  logEvent(event, true);

  if (!correct) {
    if (!state.r3.excludedTeams) state.r3.excludedTeams = [];
    if (!state.r3.excludedTeams.includes(teamId)) state.r3.excludedTeams.push(teamId);
  }
  state.r3.buzzState      = 'idle';
  state.r3.buzzedTeam     = null;
  state.r3.selectedTeam   = null;
  state.r3.selectedMember = null;
  state.showScoresOnDisplay = true;      // 加分扣分都亮记分牌，让动画有地方演
  if (correct) state.showAnswerOnDisplay = true;
  // 记分卡上飘 ±N 并闪一下（与抢跑违规同一套动画）
  state.scorePulse = { teamId: team.id, delta, pulse: (state.scorePulse?.pulse || 0) + 1 };
  stopTimer();
  save();
  return event;
}

/** 本题参赛队伍是否已全部抢答过（判错/超时），用于判断该不该自动出下一题 */
function r3AllTeamsExcluded() {
  const excluded = state.r3.excludedTeams || [];
  return state.teams.length > 0 && state.teams.every(t => excluded.includes(t.id));
}

/**
 * 开放补抢：判分后（答错/超时，记分牌已显示）主持人看完分数、手动点击才重新开放抢答，
 * 不自动续接——把节奏交给主持人。全部队伍都试过了则拒绝，改由主持人点【出题】进下一题。
 */
function r3OpenSupplement() {
  if (state.r3.currentQIdx == null) return false;
  if (r3AllTeamsExcluded()) return false;
  // 进 prearm 而不是直接 armed：补抢也要走完整发令（口令 → 3、2、1 → 滴）。
  // 否则同一道题里两次开抢的规则不一致 —— 第一次要等滴声，续抢却是话音一落就能按，
  // 选手无所适从，抢跑判罚也就失去了依据。计时由 r3SpeakGoAndArm 的 arm() 起。
  state.r3.buzzState      = 'prearm';
  state.r3.buzzedTeam     = null;
  state.r3.selectedTeam   = null;
  state.r3.selectedMember = null;
  state.showAnswerOnDisplay = false;
  state.showScoresOnDisplay = false;
  save();
  r3SpeakGoAndArm(null, '继续抢答');
  return true;
}

function r3SelectMember(memberIdx) {
  state.r3.selectedMember = memberIdx;
  save();
}

/**
 * 第三环节超时判定（业务规则，供控制台的手动"超时"按钮与倒计时归零共用）
 *
 * 只负责【扣分 + 记事件 + 清抢答状态】，不做语音与补抢决策——
 * 那些属于流程编排，留给调用方（见 index.html r3AutoTimeout / doR3Timeout）。
 *
 * 返回 ScoreEvent；非 locked 状态（无人抢答）返回 null。
 * skipAnnounce=true：调用方自行播报，避免与 announceScore 双重发声。
 */
function r3Timeout(skipAnnounce = true) {
  if (state.r3.buzzState !== 'locked') return null;
  const team = getTeam(state.r3.selectedTeam);
  if (!team) return null;
  const q     = state.r3.currentQIdx != null ? state.questions[state.r3.currentQIdx] : null;
  const delta = applyTeamScore(team.id, 'r3', getScoreCfg('r3').wrong);
  const event = {
    round: 3, teamId: team.id, teamName: team.name,
    memberIdx: state.r3.selectedMember,
    correct: false, delta, reason: 'timeout',
    qId: q?.id, ts: Date.now(),
  };
  logEvent(event, skipAnnounce);
  if (!state.r3.excludedTeams) state.r3.excludedTeams = [];
  if (!state.r3.excludedTeams.includes(team.id)) state.r3.excludedTeams.push(team.id);
  // 判罚后回到 idle（与 r3Score 一致）；由调用方播报完再决定继续抢答还是结束本题
  state.r3.buzzState      = 'idle';
  state.r3.buzzedTeam     = null;
  state.r3.selectedTeam   = null;
  state.r3.selectedMember = null;
  state.showScoresOnDisplay = true;
  // 记分卡上飘 -N 并闪一下（与答错、抢跑违规同一套动画）
  state.scorePulse = { teamId: team.id, delta, pulse: (state.scorePulse?.pulse || 0) + 1 };
  save();
  return event;
}

/** 清空抢答状态回到 idle（供超时/重置复用） */
function r3ResetBuzz() {
  state.r3.buzzState      = 'idle';
  state.r3.goCount        = null;
  state.r3.buzzedTeam     = null;
  state.r3.selectedTeam   = null;
  state.r3.selectedMember = null;
  save();
}

// =====================================================
// 第四环节 — 识图找茬
// =====================================================

function initR4() {
  state.currentRound = 4;
  state.roundPhase   = 'running';
  state.r4.currentTeamIdx = 0;
  state.r4.currentQIdx    = null;
  state.r4.usedQIds       = [];
  state.r4.spotJudge      = {};
  state.r4.extraSpots     = [];
  state.showAnswerOnDisplay = false;
  state.showScoresOnDisplay = false;
  resetTimer();
  save();
}

/** 当前已认定的找茬点总数（勾选 + 额外认定） */
function r4FoundCount() {
  return Object.values(state.r4.spotJudge).filter(Boolean).length
       + state.r4.extraSpots.length;
}

/**
 * 评委勾选找茬点
 * spotKey: string（找茬点标识）
 * found:   boolean
 * 返回 false = 已达单图上限，本次勾选被拒绝（取消勾选恒允许）
 */
function r4JudgeSpot(spotKey, found) {
  // 只拦"新增"，取消勾选必须永远放行，否则满 10 后无法纠错
  if (found && !state.r4.spotJudge[spotKey] && r4FoundCount() >= R4_MAX_SPOTS) {
    return false;
  }
  state.r4.spotJudge[spotKey] = found;
  save();
  return true;
}

/** 评委现场认定额外找茬点；返回 false = 已达上限被拒绝 */
function r4AddExtraSpot(desc) {
  if (r4FoundCount() >= R4_MAX_SPOTS) return false;
  state.r4.extraSpots.push({ desc, ts: Date.now() });
  save();
  return true;
}

/** 移除额外认定点（满 10 后需要纠错时用） */
function r4RemoveExtraSpot(idx) {
  if (idx < 0 || idx >= state.r4.extraSpots.length) return false;
  state.r4.extraSpots.splice(idx, 1);
  save();
  return true;
}

/**
 * 第四环节结算（一次性）
 * teamIdx: 队伍在出场顺序中的索引
 */
function scoreR4(teamIdx) {
  const team = getTeamByIdx(teamIdx);
  if (!team) return null;
  const q = state.r4.currentQIdx != null ? state.questions[state.r4.currentQIdx] : null;
  // 每处分值按环节配置，不读题库
  const cfg4    = getScoreCfg('r4');
  const perSpot = cfg4.perSpot;
  const found   = r4FoundCount();
  const raw     = found * perSpot;
  const capped  = cfg4.cap == null ? raw : Math.min(raw, cfg4.cap);
  const actual  = applyTeamScore(team.id, 'r4', capped);
  const event = {
    round: 4, teamId: team.id, teamName: team.name,
    correct: actual > 0, delta: actual, reason: 'spot',
    foundCount: found, perSpot, qId: q?.id, ts: Date.now(),
  };
  logEvent(event);
  return event;
}

// =====================================================
// 第五环节 — 服务飞花令
// =====================================================

function initR5() {
  state.currentRound = 5;
  state.roundPhase   = 'running';
  // 复制出场顺序，之后独立不受 forceOverride 影响
  state.r5.teamOrder       = [...state.draw.teamOrder];
  state.r5.currentThemeIdx = 0;
  state.r5.currentTurnIdx  = 0;
  state.r5.activeTeams     = [...state.draw.teamOrder];
  state.r5.timerSec        = 10;
  state.r5.usedAnswers     = [];
  state.r5.themeWinners    = [];
  state.showAnswerOnDisplay = false;
  state.showScoresOnDisplay = false;
  state.turnCard = { round: 5, revealed: false };
  state.displayMode = 'turncard';
  resetTimer();
  save();
}

/** 开始新令题（全部 5 队参加） */
function r5StartTheme(themeIdx) {
  state.r5.currentThemeIdx = themeIdx;
  state.r5.currentTurnIdx  = 0;
  state.r5.teamOrder       = [...state.draw.teamOrder];   // 加赛过会被裁剪，这里还原
  state.r5.activeTeams     = [...state.r5.teamOrder];
  state.r5.usedAnswers     = [];
  state.r5.isTiebreak      = false;
  save();
}

/**
 * 开始并列加赛令题：只有并列的队伍参加，按原出场顺序轮转
 * themeIdx: 用哪道令题加赛（通常是一道尚未用过的）
 * rank:     对第几名的并列加赛，默认 1（冠军）
 * 返回 false = 当前无并列，未启动
 */
function r5StartTiebreak(themeIdx, rank = 1) {
  const tied = hasTie(rank);
  if (tied.length < 2) return false;
  const ids = tied.map(t => t.id);

  // 保持原出场顺序，只留并列的队；draw.teamOrder 为空时退化为并列队自身顺序
  const order = state.draw.teamOrder.filter(id => ids.includes(id));
  state.r5.teamOrder       = order.length ? order : ids;
  state.r5.currentThemeIdx = themeIdx;
  state.r5.currentTurnIdx  = 0;
  state.r5.activeTeams     = [...state.r5.teamOrder];
  state.r5.usedAnswers     = [];
  state.r5.isTiebreak      = true;
  state.showScoresOnDisplay = false;
  save();
  return true;
}

/**
 * 答案归一化（用于比对，不改变展示内容）
 * 处理：首尾空白、全角→半角、常见中英文标点、大小写、内部空白
 */
function normalizeAnswer(s) {
  return String(s ?? '')
    .trim()
    // 全角字母数字空格 → 半角
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ')
    // 去掉常见标点（中英文），避免"不出卖场"与"不出卖场。"判为不同
    .replace(/[，。、；：！？「」『』（）《》〈〉【】…—～·,.;:!?"'()\[\]{}<>\-_~`]/g, '')
    // 内部空白折叠后去除
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** 该内容是否不具备可比性（空 / 未录入占位符），此类不参与查重 */
function _r5NotComparable(answer) {
  const key = normalizeAnswer(answer);
  return !key || key === normalizeAnswer(R5_BLANK_ANSWER);
}

/**
 * 查重：返回已用列表中与 answer 归一化后相同的第一条，无则 null
 * 空答案与「（未录入）」占位符不参与查重——它们不是真实答案，
 * 否则两队都留空会被判成互相重复。
 */
function r5FindDuplicate(answer) {
  if (_r5NotComparable(answer)) return null;
  const key = normalizeAnswer(answer);
  return (state.r5.usedAnswers || [])
    .find(a => !_r5NotComparable(a.answer) && normalizeAnswer(a.answer) === key) || null;
}

/**
 * 有效答案（评委点确认）
 * teamId: 当前答题队伍
 * answer: string 有效内容
 * opts.force: 跳过查重（评委判定"虽然像但确实不同"时用）
 *
 * 返回：
 *   成功 → ScoreEvent（含 delta:1）
 *   查重命中且未 force → { duplicate:true, prev:{teamId,teamName,answer,ts} }，**不计分、不推进轮次**
 *   队伍不存在 → null
 */
function r5ValidAnswer(teamId, answer, opts = {}) {
  const team = getTeam(teamId);
  if (!team) return null;

  if (!opts.force) {
    const dup = r5FindDuplicate(answer);
    if (dup) {
      const prevTeam = getTeam(dup.teamId);
      return {
        duplicate: true,
        prev: { ...dup, teamName: prevTeam?.name || '?' },
      };
    }
  }

  state.r5.usedAnswers.push({ teamId, answer, ts: Date.now() });
  const validScore = getScoreCfg('r5').valid;
  const gained     = applyTeamScore(team.id, 'r5', validScore);
  const event = {
    round: 5, teamId: team.id, teamName: team.name,
    correct: true, delta: gained, reason: 'flower_valid',
    answer, ts: Date.now(),
  };
  logEvent(event);
  state.showScoresOnDisplay = true;   // 每答对一条就及时把记分牌亮出来
  _r5NextTurn();
  return event;
}

/**
 * 出局（超时、重复、答错）
 * teamId: 出局队伍
 */
function r5Eliminate(teamId) {
  const team = getTeam(teamId);
  if (!team) return null;
  state.r5.activeTeams = state.r5.activeTeams.filter(id => id !== teamId);
  const event = {
    round: 5, teamId: team.id, teamName: team.name,
    correct: false, delta: 0, reason: 'wrong',
    eliminated: true, ts: Date.now(),
  };
  logEvent(event, true);
  state.showScoresOnDisplay = true;   // 出局也是一次战况变化，记分牌同步亮出来
  save();
  if (window.IS_CONTROL) speak(`${team.name}出局`);
  // 检查是否只剩一队（擂主）
  if (state.r5.activeTeams.length === 1) {
    r5SetWinner(state.r5.activeTeams[0]);
  } else {
    _r5NextTurn();
  }
  return event;
}

/** 设置本令题擂主，额外+3分 */
function r5SetWinner(teamId) {
  const team = getTeam(teamId);
  if (!team) return null;
  // 本令题已有擂主则不重复加分（防手动指定与"剩一队自动定擂主"重复触发）
  if ((state.r5.themeWinners || []).some(w => w.themeIdx === state.r5.currentThemeIdx)) return null;
  const gained = applyTeamScore(team.id, 'r5', getScoreCfg('r5').winner);
  state.r5.themeWinners.push({ themeIdx: state.r5.currentThemeIdx, teamId });
  const event = {
    round: 5, teamId: team.id, teamName: team.name,
    correct: true, delta: gained, reason: 'flower_winner',
    ts: Date.now(),
  };
  logEvent(event);
  state.showScoresOnDisplay = true;
  save();
  return event;
}

/** 内部：推进到下一个轮次 */
function _r5NextTurn() {
  const active = state.r5.activeTeams;
  if (!active.length) return;
  // 找到下一个 active 队在 teamOrder 中的位置
  const order = state.r5.teamOrder;
  let next = (state.r5.currentTurnIdx + 1) % order.length;
  let guard = 0;
  while (!active.includes(order[next]) && guard < order.length) {
    next = (next + 1) % order.length;
    guard++;
  }
  state.r5.currentTurnIdx = next;
  save();
  startTimer(state.r5.timerSec * 1000, 5);
}

// =====================================================
// 事件记录与分数调整
// =====================================================

/**
 * 记录得分事件（同时调用 announceScore）
 * skipAnnounce: 跳过语音播报（用于违规抢答，避免双重播报）
 */
function logEvent(event, skipAnnounce = false) {
  state.history.push(event);
  if (!skipAnnounce) {
    announceScore(event);
  }
  save();
}

/**
 * 任意调整分数（设置面板）
 * round: 'r1'|'r2'|'r3'|'r4'|'r5'
 */
function adjustScore(teamId, round, delta) {
  const team = getTeam(teamId);
  if (!team) return;
  team.scores[round] = (team.scores[round] || 0) + delta;
  const event = {
    round: parseInt(round.slice(1)),
    teamId: team.id, teamName: team.name,
    correct: delta >= 0, delta, reason: 'adjust', manual: true, ts: Date.now(),
  };
  logEvent(event);
}

// =====================================================
// 大屏展示控制
// =====================================================

function toggleShowScores(force) {
  state.showScoresOnDisplay = force !== undefined ? !!force : !state.showScoresOnDisplay;
  save();
}

function toggleShowAnswer(force) {
  state.showAnswerOnDisplay = (force !== undefined) ? !!force : !state.showAnswerOnDisplay;
  state.showScoresOnDisplay = state.showAnswerOnDisplay;
  save();
}

function setDisplayMode(mode) {
  state.displayMode = mode;
  save();
}

// =====================================================
// 全局重置
// =====================================================

function clearAllScores() {
  state.teams.forEach(t => {
    t.scores = { r1:0, r2:0, r3:0, r4:0, r5:0 };
    t.memberScores = { 0:0, 1:0, 2:0, 3:0 };
  });
  state.history      = [];
  state.currentRound = 0;
  state.roundPhase   = 'idle';
  _resetR3();
  resetTimer();
  save();
}

function _resetR3() {
  state.r3.buzzState      = 'idle';
  state.r3.goCount        = null;
  state.r3.buzzedTeam     = null;
  state.r3.selectedTeam   = null;
  state.r3.selectedMember = null;
  state.r3.violatedTeams  = [];
}

/**
 * 重置本场比赛 —— 回到「开赛前」的干净状态，供彩排 / 反复测试用。
 *
 * 只清【赛况】，不动【配置与素材】：
 *   清空 —— 分数、个人分、判分流水、抽题记录（usedQIds）、牌组、
 *           各环节进度与当前题、计时器、大屏各展示开关与小结、规则已读标记
 *   保留 —— 题库内容、队伍与队员、抽签结果、抽题/计分/倒计时配置、规则文案、
 *           品牌与背景图、R4 场景图与找茬点坐标、TTS 设置
 *
 * 为什么另起一个函数而不是扩展 clearAllScores()：
 *   · clearAllScores() 只归零分数，usedQIds 与牌组仍在 —— 再测一遍会「题都被抽走了」
 *   · loadQuestions() 虽然清得干净，但它是「换题库」的入口，要求重新导入
 * 抽签不在此清（另有 [重置抽签] 按钮）：重测时通常还想沿用同一套出场顺序与图题分配，
 * 清掉的话每次都得重抽一遍才能开 R2/R4。
 */
function resetContest() {
  // 分数与流水
  state.teams.forEach(t => {
    t.scores      = { r1:0, r2:0, r3:0, r4:0, r5:0 };
    t.memberScores = { 0:0, 1:0, 2:0, 3:0 };
  });
  state.history = [];

  // 抽题池：全部题目回到「未抽」
  state.usedQIds = [];

  // 牌组作废，回到无牌状态
  state.cardFlip.cards           = [];
  state.cardFlip.context         = { round: null, teamId: null, memberIdx: null, pickCount: 0, picked: [] };
  state.cardFlip.flipPulse       = 0;
  state.cardFlip.lastFlippedCard = null;

  // 各环节进度与当前题
  state.r1.currentTeamIdx = 0;    state.r1.currentMemberIdx = 0;
  state.r1.currentQIdx    = null; state.r1.usedQIds         = [];
  state.r1.turnQIds       = [];   state.r1.turnSubIdx       = 0;

  state.r2.currentTeamIdx = 0;    state.r2.currentMemberIdx = null;
  state.r2.currentQIdx    = null; state.r2.usedQIds         = [];
  state.r2.turnQIdxs      = [];   state.r2.qNum             = 0;
  state.r2.turnResults    = [];

  state.r3.currentQIdx    = null; state.r3.usedQIds         = [];
  state.r3.excludedTeams  = [];   state.r3.currentReadText  = '';
  state.r3.buzzPulse      = 0;    state.r3.lastBuzzTeam     = null;
  _resetR3();

  state.r4.currentTeamIdx = 0;    state.r4.currentQIdx      = null;
  state.r4.usedQIds       = [];   state.r4.spotJudge        = {};
  state.r4.extraSpots     = [];

  state.r5.currentThemeIdx = 0;   state.r5.currentTurnIdx   = 0;
  state.r5.teamOrder       = [];  state.r5.activeTeams      = [];
  state.r5.usedAnswers     = [];  state.r5.themeWinners     = [];
  state.r5.isTiebreak      = false;

  // 赛程与大屏
  state.currentRound        = 0;
  state.roundPhase          = 'idle';
  state.pickedAnswer        = null;
  state.showAnswerOnDisplay = false;
  state.showScoresOnDisplay = false;
  state.roundSummary        = null;
  state.scorePulse          = null;
  state.turnCard            = { round: null, revealed: false };
  state.displayMode         = 'question';
  state.roundRulesDismissed = {};   // 各环节规则窗口重新展示并朗读

  resetTimer();
  save();
}

function resetTeams() {
  state.teams   = defaultTeams();
  state.keymap  = { 1:['1','q','Q'], 2:['2','w','W'], 3:['3','e','E'], 4:['4','r','R'], 5:['5','t','T'] };
  save();
}

function resetDraw() {
  state.draw = {
    teamOrder:   [],
    orderLocked: false,
    log:         [],
  };
  save();
}

/** 停止计时（内部辅助，不写入 save；save 由调用方负责） */
function stopTimer() {
  state.timer.state = 'idle';
}

/**
 * 导入题库：整库替换，并让旧题库彻底失效。
 *
 * 为什么要连带清状态：抽题记录（usedQIds）、牌组（cardFlip.cards 里的 qIds）、
 * 各环节的当前题都是按【题目 id】记的。只换 questions 不清这些，旧 id 会变成
 * 找不到题的悬空引用 —— 现场表现是「翻了牌但题目区空白」，且旧的已用记录会
 * 无谓占掉新题库的抽题额度。所以导入即视为重新开局。
 *
 * 不动的：队伍/队员、分数与判分流水、抽签结果、品牌与规则等赛前设置。
 * 分数要清请另点「清空所有分数」。
 */
function loadQuestions(data) {
  if (!data || !Array.isArray(data.questions)) return false;
  state.questions = data.questions;

  // 抽题池归零
  state.usedQIds = [];

  // 牌组作废，回到无牌状态（大屏会落到赛前背景，不会停在空白翻牌页）
  state.cardFlip.cards           = [];
  state.cardFlip.context         = { round: null, teamId: null, memberIdx: null, pickCount: 0, picked: [] };
  state.cardFlip.flipPulse       = 0;
  state.cardFlip.lastFlippedCard = null;

  // 各环节的「当前题/本轮题」全部清空，避免悬空 id
  state.r1.currentQIdx = null;  state.r1.usedQIds   = [];
  state.r1.turnQIds    = [];    state.r1.turnSubIdx = 0;
  state.r2.currentQIdx = null;  state.r2.usedQIds   = [];
  state.r2.turnQIdxs   = [];    state.r2.qNum       = 0;  state.r2.turnResults = [];
  state.r3.currentQIdx = null;  state.r3.usedQIds   = [];
  state.r3.excludedTeams = [];
  _resetR3();
  state.r4.currentQIdx = null;  state.r4.usedQIds   = [];
  state.r4.spotJudge   = {};    state.r4.extraSpots = [];
  state.r5.usedAnswers = [];    state.r5.themeWinners = [];

  state.pickedAnswer        = null;
  state.showAnswerOnDisplay = false;
  state.showScoresOnDisplay = false;
  state.turnCard            = { round: null, revealed: false };
  state.displayMode         = 'question';
  state.roundRulesDismissed = {};
  resetTimer();
  save();
  return true;
}

function setLogo(dataUrl) { state.logo = dataUrl; save(); }
function setBrandName(name) { state.brandName = name || ''; save(); }
function setPrepBg(dataUrl) { state.prepBg = dataUrl || null; save(); }
function setQuestionBg(dataUrl) { state.questionBg = dataUrl || null; save(); }
function setRoundRules(round, text) {
  if (!state.roundRules) state.roundRules = {};
  state.roundRules[round] = text || '';
  save();
}

// ── 规则文案占位符 ─────────────────────────────────
// 规则文案里的分数、秒数以前是手打的，改了计分/倒计时配置就对不上，
// 念出来和实际判分两回事。现在文案里写 {分值} {秒数} 这类占位符，
// 显示和朗读前统一按当前配置替换 —— 大屏和控制台走的是同一个函数，不会各念各的。
//
// 未定义的占位符原样保留（当成普通文字），不会变成 undefined。

/** 某环节可用的占位符 → 当前值。UI 的可用列表也从这里取，加字段不用两处改。 */
function ruleVars(round) {
  const r   = Number(round);
  const key = 'r' + r;
  const sc  = getScoreCfg(key);
  const cfg = getRoundCfg(r);
  const num = v => String(Math.round(v * 100) / 100);
  const vars = {
    '秒数':   String(state['r' + r]?.timerSec ?? ''),
    // {上限} 给的是一句完整的话，不是光秃秃一个数字 —— 不封顶时若只替换数字，
    // 模板里「累计上限 X 分」会念成「累计上限 不设上限 分」。只要数字用 {上限分}。
    '上限':   sc.cap == null ? '不设上限' : `累计上限 ${num(sc.cap)} 分`,
    '上限分': sc.cap == null ? '无上限' : num(sc.cap),
    '队伍数': String(state.teams.length),
  };
  if (r <= 3) {
    vars['题数'] = String(cfg.perTurn);
    vars['轮数'] = r === 2 ? String(state.draw.teamOrder.length || state.teams.length) : String(cfg.turns);
  }
  if (r === 1 || r === 2 || r === 3) vars['分值'] = num(sc.correct);
  if (r === 1 || r === 2) vars['翻牌秒数'] = String(state['r' + r].flipTimerSec ?? 0);
  if (r === 3) vars['扣分'] = num(Math.abs(sc.wrong));      // 念「答错扣 2 分」，取绝对值更顺
  if (r === 4) { vars['分值'] = num(sc.perSpot); vars['处数'] = String(R4_MAX_SPOTS); }
  if (r === 5) { vars['分值'] = num(sc.valid);   vars['擂主分'] = num(sc.winner); }
  return vars;
}

/** 把文案里的 {占位符} 换成当前配置值；未识别的原样留着 */
function fillRuleVars(text, round) {
  if (!text) return '';
  const vars = ruleVars(round);
  return String(text).replace(/\{([^{}]+)\}/g, (whole, name) => {
    const v = vars[name.trim()];
    return v === undefined ? whole : v;
  });
}

/** 取某环节【已替换占位符】的规则文案，大屏与朗读都用这个 */
function getRoundRulesText(round) {
  const raw = state.roundRules?.[round];
  return raw == null ? '' : fillRuleVars(String(raw), round).trim();
}

// =====================================================
// 成绩报告导出（赛后存档）
// =====================================================

const ROUND_NAMES_CN = ['', '个人必答', '团队共答', '擂台抢答', '识图找茬', '服务飞花令'];

function _csvCell(v) {
  const s = String(v ?? '');
  // 含逗号/引号/换行的单元格必须加引号，内部引号翻倍
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function _csvRows(rows) {
  return rows.map(r => r.map(_csvCell).join(',')).join('\r\n');
}
function _fmtTs(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 队伍成绩表 CSV（含名次、各环节、总分） */
function buildTeamScoresCSV() {
  const ranking = getRanking();
  const rows = [['名次', '队伍', '个人必答', '团队共答', '擂台抢答', '识图找茬', '服务飞花令', '总分']];
  ranking.forEach((r, i) => {
    const s = r.team.scores;
    rows.push([i + 1, r.team.name, s.r1 || 0, s.r2 || 0, s.r3 || 0, s.r4 || 0, s.r5 || 0, r.total]);
  });
  return _csvRows(rows);
}

/**
 * 个人成绩表 CSV，用于评「最佳个人」（见 6.2）。
 * 个人分只来自 ①个人必答 与 ③擂台抢答 —— 只有这两个环节有明确的作答人；
 * 且不受队伍封顶裁剪，否则全队答满触顶的队伍反而评不出最佳个人。
 */
function buildMemberScoresCSV() {
  const rows = [['队伍', '姓名', '个人得分(①个人必答＋③擂台抢答)']];
  const all = [];
  state.teams.forEach(t => {
    (t.members || []).forEach((name, i) => {
      all.push({ team: t.name, name, score: t.memberScores?.[i] || 0 });
    });
  });
  all.sort((a, b) => b.score - a.score);
  all.forEach(m => rows.push([m.team, m.name, m.score]));
  return _csvRows(rows);
}

/** 判分流水 CSV（全量 history，用于复盘/申诉） */
function buildHistoryCSV() {
  const rows = [['时间', '环节', '队伍', '选手', '判定', '队伍分差', '个人分差', '题号', '答案', '备注']];
  (state.history || []).forEach(e => {
    rows.push([
      _fmtTs(e.ts),
      ROUND_NAMES_CN[e.round] || e.round,
      e.teamName || '',
      e.memberName || '',
      e.reason || '',
      e.delta ?? '',
      e.memberDelta ?? '',
      e.qId || '',
      e.answer || '',
      [e.note, e.capped ? '(队伍已封顶)' : '', e.eliminated ? '(出局)' : '', e.manual ? '(手动调分)' : '']
        .filter(Boolean).join(' '),
    ]);
  });
  return _csvRows(rows);
}

/** 完整存档 JSON（可重新导入 localStorage 复现赛况） */
function buildArchiveJSON() {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    brandName:  state.brandName,
    ranking:    getRanking().map((r, i) => ({ rank: i + 1, team: r.team.name, total: r.total })),
    tieGroups:  getTieGroups().map(g => ({ total: g.total, teams: g.teams.map(t => t.name) })),
    teams:      state.teams,
    draw:       state.draw,
    r5:         { themeWinners: state.r5.themeWinners, isTiebreak: state.r5.isTiebreak },
    history:    state.history,
  }, null, 2);
}

// =====================================================
// HTML 工具
// =====================================================
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}
function escapeAttr(s) { return escapeHtml(s); }
function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

// ── 初始化 ───────────────────────────────────────
load();
