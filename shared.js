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

const TEAM_COLORS = ['#ef4444','#f59e0b','#22c55e','#3b82f6','#a855f7'];

const ROUND_CAPS = { r1: 20, r2: 20, r3: null, r4: 10, r5: null };

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
    // ── 元数据 ──────────────────────────────────
    teams: defaultTeams(),
    keymap: { 1:['1','q','Q'], 2:['2','w','W'], 3:['3','e','E'], 4:['4','r','R'], 5:['5','t','T'] },
    logo: null,
    brandName: '',
    prepBg: null,            // 赛前准备大屏背景图（整屏铺满）
    // 各环节规则说明（大屏翻牌选题时显示在上方窗口）。按环节号存，可自行维护文案。
    roundRules: {
      1: '一、每队选手依次上场，每人作答一题。\n二、主持人翻牌选题，题目当场揭晓。\n三、答对得 2.5 分，答错或超时不得分、不倒扣。\n四、每队本环节累计上限 20 分。\n五、每题限时 15 秒，倒计时结束即停止作答。',
      2: '一、各队按抽签顺序依次上场，每队翻牌后连答 4 道题。\n二、每题由一名队员作答，作答队员现场指定。\n三、答对每题得 5 分，答错或超时不得分、不倒扣。\n四、每队本环节累计上限 20 分。\n五、每题限时 40 秒。',
      3: '一、主持人出题并宣布「开始抢答」后，各队方可按抢答器。\n二、最先抢到的队伍作答，答对加 2 分，答错扣 2 分。\n三、抢答犯规（抢答口令前抢按）扣分并暂停一次抢答资格。\n四、本环节不设上限。',
      4: '一、各队依次上场，在场景图中找出服务不规范之处。\n二、每找对一处得 1 分，每图至多 10 处。\n三、每队本环节累计上限 10 分。\n四、限时结束即停止作答，误报不倒扣。',
      5: '一、各队围绕主题轮流说出符合要求的服务用语或要点。\n二、每答出一条有效内容得 1 分；本题擂主额外得 3 分。\n三、重复、不符或限时内答不出即淘汰出本题。\n四、本环节不设上限。',
    },
    roundRulesDismissed: {}, // 规则朗读完毕后置 true，大屏据此自动关闭规则窗口

    // ── 题库 ────────────────────────────────────
    questions: [],           // 完整题库数组

    // ── 赛程控制 ────────────────────────────────
    currentRound: 0,         // 0=赛前, 1-5=对应环节
    roundPhase: 'idle',      // idle|running|judging|finished

    // ── 第一环节 个人必答 ────────────────────────
    r1: {
      currentTeamIdx:  0,    // 指向 draw.teamOrder 的下标
      currentMemberIdx: 0,   // 0-3
      currentQIdx:     null, // 当前题目在 questions[] 中的索引
      usedQIds:        [],   // 已用题目 id
      timerSec:        15,
      autoAdvance:     true, // 判分播报完后自动切到下一位答题人
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
    },

    // ── 第三环节 擂台抢答 ────────────────────────
    r3: {
      currentQIdx:     null,
      usedQIds:        [],
      timerSec:        15,
      buzzState:       'idle',   // idle|reading|armed|locked
      buzzedTeam:      null,
      selectedTeam:    null,
      selectedMember:  null,
      buzzPulse:       0,
      lastBuzzTeam:    null,
      supplementUsed:  false,
      currentReadText: '',
    },

    // ── 第四环节 识图找茬 ────────────────────────
    r4: {
      currentTeamIdx: 0,     // 指向 draw.teamOrder 的下标
      currentQIdx:    null,  // 当前图题在 questions[] 中的索引
      usedQIds:       [],
      timerSec:       60,
      spotJudge:      {},    // {spotKey: true/false} 评委勾选结果
      extraSpots:     [],    // 评委现场认定额外找茬点
      imageFiles: {          // imageKey → 图片文件路径（相对 html 所在目录）
        '图A': 'images/图A.png',
        '图B': 'images/图B.png',
        '图C': 'images/图C.png',
        '图D': 'images/图D.png',
        '图E': 'images/图E.png',
      },
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
      deckSize: { 1: 40, 2: 0 },        // 每环节翻牌张数（0 = 用全部可用题目）；R4 按队伍数固定
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
    draw: {
      teamOrder:  [],            // teamId[]，5支队伍出场顺序
      r4ImageMap: {},            // {teamId: imageKey}，第四环节图题分配
      orderLocked: false,
      imageLocked: false,
      log:        [],            // {type,prev,result,operator,ts}
    },

    // ── 历史记录 ────────────────────────────────
    history: [],                 // ScoreEvent[]

    // ── 大屏展示控制 ────────────────────────────
    showScoresOnDisplay: false,
    showAnswerOnDisplay: false,
    // 选手所选的选项字母数组（如 ['B']）。大屏据此高亮：选对=绿、选错=红。
    // 揭晓正确答案（showAnswerOnDisplay）之前先只显示它，实现「先红后揭晓」的两段式。
    pickedAnswer: null,
    displayMode: 'question',     // question|scores|blank|cardflip|draw

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
  const cap     = ROUND_CAPS[roundKey];
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

/** 第四环节：imageKey → 图片文件路径（可用 setR4ImageFile 覆盖默认约定） */
function getR4ImageSrc(imageKey) {
  if (!imageKey) return null;
  return state.r4.imageFiles?.[imageKey] || `images/${imageKey}.png`;
}

function setR4ImageFile(imageKey, path) {
  if (!state.r4.imageFiles) state.r4.imageFiles = {};
  state.r4.imageFiles[imageKey] = path;
  save();
}

// ── 持久化 ───────────────────────────────────────
function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const loaded = JSON.parse(raw);
    state = deepMerge(defaultState(), loaded);
  } catch(e) { console.warn('[rz] load failed', e); }
}

function save(broadcast = true) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (broadcast && bc) {
    try { bc.postMessage({ type: 'state', state }); } catch(e) {}
  }
  listeners.forEach(fn => fn());
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── 跨窗口同步 ──────────────────────────────────
if (bc) {
  bc.addEventListener('message', e => {
    if (e.data?.type === 'state') {
      state = e.data.state;
      listeners.forEach(fn => fn());
    }
  });
}
window.addEventListener('storage', e => {
  if (e.key === STORAGE_KEY && e.newValue) {
    try {
      state = deepMerge(defaultState(), JSON.parse(e.newValue));
      listeners.forEach(fn => fn());
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
    '开始抢答', '时间到', '时间到，作答超时', '时间到，无人抢答',
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
function _fetchAudio(text) {
  const key = _cacheKey(text);
  if (_audioCache.has(key)) return Promise.resolve(_audioCache.get(key));
  if (_inflight.has(key))   return _inflight.get(key);

  const ctl = new AbortController();
  _fetchCtls.add(ctl);
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
    } finally {
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

/** 播放单条文本（立即打断当前播放） */
function speak(text, opts = {}) {
  if (!isTTSAvailable()) { opts.onend?.(); return; }
  _cancelAll();
  const seq = _speakSeq;
  _speakOne(text, opts.onend, seq, opts);
}

/** 顺序播放多段文本；全部播完后调用 onAllDone */
function speakQueue(segments, onAllDone) {
  if (!isTTSAvailable()) { onAllDone?.(); return; }
  _cancelAll();
  _ttsQueue = [...segments];
  _prefetchAll(_ttsQueue);          // 先并行发起全部合成，再顺序播放
  _drainQueue(onAllDone, _speakSeq);
}

function _drainQueue(onAllDone, seq) {
  if (seq !== _speakSeq) return;                       // 整个队列已被打断
  if (!_ttsQueue.length) { _ttsBusy = false; onAllDone?.(); return; }
  _ttsBusy = true;
  const text = _ttsQueue.shift();
  if (!text) { _drainQueue(onAllDone, seq); return; }
  _speakOne(text, () => _drainQueue(onAllDone, seq), seq);
}

function stopSpeak() {
  _cancelAll();
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

/** 抽取第四环节图题分配 */
function drawR4Images(imageKeys) {
  if (state.draw.imageLocked) return false;
  // imageKeys: string[]，长度 >= 5，从中随机分配
  const shuffled = fisherYates(imageKeys).slice(0, 5);
  state.draw.r4ImageMap = {};
  state.draw.teamOrder.forEach((teamId, i) => {
    state.draw.r4ImageMap[teamId] = shuffled[i];
  });
  state.draw.log.push({ type:'draw_images', result:{...state.draw.r4ImageMap}, ts: Date.now() });
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

/** 锁定图题分配 */
function lockDrawImages() {
  if (!Object.keys(state.draw.r4ImageMap).length) return false;
  state.draw.imageLocked = true;
  state.draw.log.push({ type:'lock_images', ts: Date.now() });
  save();
  return true;
}

/** 解锁图题分配 */
function unlockDrawImages() {
  state.draw.imageLocked = false;
  state.draw.log.push({ type:'unlock_images', ts: Date.now() });
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
 * 第四环节: 5张图题卡（按 draw.teamOrder 对应 r4ImageMap）
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

function initCardDeck(round) {
  if (!state.cardFlip.rounds[round]) return false;
  let cards = [];
  // 说明：下方任一分支都可能因「题库未导入」或「R4 未分配图」而产出空牌组。
  // 空牌组必须【在改动 state 之前】就返回 false —— 否则会造出
  // displayMode='cardflip' 但 cards=[] 的矛盾状态，大屏会静默掉回"等待出题"，
  // 主持人在台上完全不知道发生了什么。见函数末尾的守卫。
  if (round === 1) {
    const pool = state.questions.filter(q => q.round === 1);
    const shuffled = deckSlice(fisherYates(pool), round);
    cards = shuffled.map((q, i) => ({
      id:       `r1_${i}`,
      cardNum:  i + 1,
      qId:      q.id,
      revealed: false,
      used:     false,
    }));
  } else if (round === 2) {
    // R2 每队一张牌（按抽签顺序上场），牌本身不绑题——翻牌后统一答同一组题
    const n = state.draw.teamOrder.length || state.teams.length;
    cards = Array.from({ length: n }, (_, i) => ({
      id:       `r2_${i}`,
      cardNum:  i + 1,
      revealed: false,
      used:     false,
    }));
  } else if (round === 4) {
    cards = state.draw.teamOrder.map((teamId, i) => ({
      id:       `r4_${i}`,
      cardNum:  i + 1,
      teamId,
      imageKey: state.draw.r4ImageMap[teamId] || null,
      revealed: false,
      used:     false,
    }));
  }

  // 守卫：牌组为空就不进入翻牌模式，且【不改动任何 state】。
  // 调用方必须检查返回值并给出可操作的提示（见 index.html 各 rxInit）。
  if (!cards.length) return false;

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

/** 某环节可用的题目数（翻牌与出题的前置条件） */
function countQuestions(round) {
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
  if (round === 1 && card.qId != null) {
    const idx = state.questions.findIndex(q => q.id === card.qId);
    if (idx >= 0) state.r1.currentQIdx = idx;
  } else if (round === 2 && card.qId != null) {
    const idx = state.questions.findIndex(q => q.id === card.qId);
    if (idx >= 0) state.r2.currentQIdx = idx;
  } else if (round === 4 && card.imageKey != null) {
    const idx = state.questions.findIndex(q => q.imageKey === card.imageKey);
    if (idx >= 0) state.r4.currentQIdx = idx;
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
  const baseScore = q?.score_correct ?? 2.5;

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
  logEvent(event);
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

/** 本环节全部团队共答题在 questions[] 的索引（题量少，所有队答同一组） */
function r2QuestionIdxs() {
  const idxs = [];
  state.questions.forEach((q, i) => { if (q.round === 2) idxs.push(i); });
  return idxs;
}

/** 开始当前上场队的一轮：装载全部 R2 题，从第 1 题开始 */
function r2StartTurn() {
  state.r2.turnQIdxs   = r2QuestionIdxs();
  state.r2.qNum        = 0;
  state.r2.turnResults = [];
  state.r2.currentQIdx = state.r2.turnQIdxs.length ? state.r2.turnQIdxs[0] : null;
  save();
}

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
  const delta  = correct ? (q?.score_correct ?? 5) : 0;
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
  logEvent(event);
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
function scoreR2Multi(teamId, selected, correctOptions, totalScore = 5) {
  const team = getTeam(teamId);
  if (!team) return null;
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
function scoreR2FillMulti(teamId, blanks, correctBlanks, totalScore = 5) {
  const team = getTeam(teamId);
  if (!team) return null;
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
  state.r3.supplementUsed  = false;
  state.r3.currentReadText = '';
  state.showAnswerOnDisplay = false;
  state.showScoresOnDisplay = false;
  resetTimer();
  save();
}

/**
 * 出题：开始读题（TTS），读完后自动进入 armed 状态
 * qIdx: questions[] 中的索引
 * onArmed: callback，TTS 读完"开始抢答"后调用
 */
function r3StartQuestion(qIdx, onArmed) {
  const q = state.questions[qIdx];
  if (!q) return false;
  state.r3.currentQIdx     = qIdx;
  state.r3.buzzState       = 'reading';
  state.r3.buzzedTeam      = null;
  state.r3.selectedTeam    = null;
  state.r3.selectedMember  = null;
  state.r3.supplementUsed  = false;
  state.r3.currentReadText = q.stem || '';
  state.showAnswerOnDisplay = false;
  save();

  if (window.IS_CONTROL) {
    const segs = [...buildQuestionSegments(q), '开始抢答'];
    speakQueue(segs, () => {
      state.r3.buzzState = 'armed';
      save();
      onArmed?.();
      startTimer(state.r3.timerSec * 1000, 3);
    });
  } else {
    onArmed?.();
  }
  return true;
}

/**
 * 尝试抢答（在 reading 状态按下 = 违规；armed 状态按下 = 成功）
 */
function r3TryBuzz(teamId, onViolationDone) {
  if (state.r3.buzzState === 'reading') {
    return r3EarlyBuzz(teamId, onViolationDone);
  }
  if (state.r3.buzzState !== 'armed') return false;
  const team = getTeam(teamId);
  if (!team) return false;
  state.r3.buzzState      = 'locked';
  state.r3.buzzedTeam     = teamId;
  state.r3.selectedTeam   = teamId;
  state.r3.selectedMember = null;
  state.r3.buzzPulse      = (state.r3.buzzPulse || 0) + 1;
  state.r3.lastBuzzTeam   = teamId;
  // 抢答窗口计时结束，重启 15 秒答题倒计时（见 4.3）
  startTimer(state.r3.timerSec * 1000, 3);

  if (window.IS_CONTROL) {
    speak(`${team.name}抢答成功，请答题`);
  }
  return true;
}

/**
 * 违规抢答（读题期间按下抢答器）
 */
function r3EarlyBuzz(teamId, onDone) {
  const team = getTeam(teamId);
  if (!team) return false;
  // 暂停 TTS
  if (window.IS_CONTROL) stopSpeak();
  // 扣分：违规是行为处罚，用固定常量，不读题库分值
  const delta = applyTeamScore(team.id, 'r3', R3_VIOLATION_PENALTY);
  const event = {
    round: 3, teamId: team.id, teamName: team.name,
    correct: false, delta, reason: 'violation',
    ts: Date.now(),
  };
  logEvent(event, true); // skipAnnounce
  save();

  if (window.IS_CONTROL) {
    speakQueue(
      [`${team.name}，抢答违规，扣两分`],
      () => resumeR3Reading(onDone)
    );
  } else {
    resumeR3Reading(onDone);
  }
  return true;
}

/** 违规播报完后继续读题 */
function resumeR3Reading(onArmed) {
  const qIdx = state.r3.currentQIdx;
  const q    = qIdx != null ? state.questions[qIdx] : null;
  if (!q) return;
  state.r3.buzzState = 'reading';
  save();
  if (window.IS_CONTROL) {
    const segs = [...buildQuestionSegments(q), '开始抢答'];
    speakQueue(segs, () => {
      state.r3.buzzState = 'armed';
      save();
      onArmed?.();
      startTimer(state.r3.timerSec * 1000, 3);
    });
  } else {
    onArmed?.();
  }
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
  const delta = correct ? (q?.score_correct ?? 2) : (q?.score_wrong ?? -2);
  applyTeamScore(team.id, 'r3', delta);
  team.memberScores[memberIdx] = (team.memberScores[memberIdx] || 0) + delta;
  const event = {
    round: 3, teamId: team.id, teamName: team.name,
    memberIdx, memberName: team.members[memberIdx],
    correct, delta, reason: correct ? 'correct' : 'wrong',
    qId: q?.id,
    fromBuzz: true, ts: Date.now(),
  };
  logEvent(event);

  state.r3.buzzState      = 'idle';
  state.r3.buzzedTeam     = null;
  state.r3.selectedTeam   = null;
  state.r3.selectedMember = null;
  if (correct) {
    state.showAnswerOnDisplay = true;
    state.showScoresOnDisplay = true;
  }
  stopTimer();
  save();
  return event;
}

/**
 * 开放补抢（答错或超时后主持人触发）
 */
function r3OpenSupplement() {
  if (state.r3.supplementUsed) return false;
  if (state.r3.buzzState !== 'locked') return false;
  state.r3.supplementUsed = true;
  state.r3.buzzState      = 'armed';
  state.r3.buzzedTeam     = null;
  state.r3.selectedTeam   = null;
  state.r3.selectedMember = null;
  save();
  if (window.IS_CONTROL) speak('开放补抢');
  startTimer(state.r3.timerSec * 1000, 3);
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
  const delta = applyTeamScore(team.id, 'r3', q?.score_wrong ?? -2);
  const event = {
    round: 3, teamId: team.id, teamName: team.name,
    memberIdx: state.r3.selectedMember,
    correct: false, delta, reason: 'timeout',
    qId: q?.id, ts: Date.now(),
  };
  logEvent(event, skipAnnounce);
  state.showScoresOnDisplay = true;
  save();
  return event;
}

/** 清空抢答状态回到 idle（供超时/重置复用） */
function r3ResetBuzz() {
  state.r3.buzzState      = 'idle';
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
  // 每处分值读题库，兜底 1（此前硬编码 1，题库的 score_correct 是装饰性字段）
  const perSpot = q?.score_correct ?? 1;
  const found   = r4FoundCount();
  const raw     = found * perSpot;
  const actual  = applyTeamScore(team.id, 'r4', Math.min(raw, ROUND_CAPS.r4));
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
  applyTeamScore(team.id, 'r5', 1);
  const event = {
    round: 5, teamId: team.id, teamName: team.name,
    correct: true, delta: 1, reason: 'flower_valid',
    answer, ts: Date.now(),
  };
  logEvent(event);
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
  applyTeamScore(team.id, 'r5', 3);
  state.r5.themeWinners.push({ themeIdx: state.r5.currentThemeIdx, teamId });
  const event = {
    round: 5, teamId: team.id, teamName: team.name,
    correct: true, delta: 3, reason: 'flower_winner',
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
  state.r3.buzzedTeam     = null;
  state.r3.selectedTeam   = null;
  state.r3.selectedMember = null;
}

function resetTeams() {
  state.teams   = defaultTeams();
  state.keymap  = { 1:['1','q','Q'], 2:['2','w','W'], 3:['3','e','E'], 4:['4','r','R'], 5:['5','t','T'] };
  save();
}

function resetDraw() {
  state.draw = {
    teamOrder:   [],
    r4ImageMap:  {},
    orderLocked: false,
    imageLocked: false,
    log:         [],
  };
  save();
}

/** 停止计时（内部辅助，不写入 save；save 由调用方负责） */
function stopTimer() {
  state.timer.state = 'idle';
}

function loadQuestions(data) {
  if (!data || !Array.isArray(data.questions)) return false;
  state.questions = data.questions;
  save();
  return true;
}

function setLogo(dataUrl) { state.logo = dataUrl; save(); }
function setBrandName(name) { state.brandName = name || ''; save(); }
function setPrepBg(dataUrl) { state.prepBg = dataUrl || null; save(); }
function setRoundRules(round, text) {
  if (!state.roundRules) state.roundRules = {};
  state.roundRules[round] = text || '';
  save();
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

/** 个人成绩表 CSV（R1 个人分不受队伍上限影响，可据此评「最佳个人」，见 6.2） */
function buildMemberScoresCSV() {
  const rows = [['队伍', '姓名', '个人得分(R1)']];
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
