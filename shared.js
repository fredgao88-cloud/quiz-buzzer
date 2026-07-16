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
    },

    // ── 第二环节 团队共答 ────────────────────────
    r2: {
      currentQIdx: null,
      usedQIds:    [],
      timerSec:    40,
      answers:     {},       // {teamId: 已提交答案}
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
    },

    // ── 翻牌选题 ────────────────────────────────
    cardFlip: {
      enabled: true,
      rounds:  { 1: true, 2: true, 4: true },   // 哪些环节开启翻牌
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
 * 统一加分入口：按环节上限裁剪后写入队伍分数（见第六章）
 * roundKey: 'r1'~'r5'；有上限的环节按 clamp(delta, 0, cap - current) 裁剪，
 * 无上限环节（r3/r5）原样累加（可为负）。返回实际生效的分差。
 * 注意：不 save()，由调用方负责。
 */
function applyTeamScore(teamId, roundKey, delta) {
  const team = getTeam(teamId);
  if (!team) return 0;
  const cap     = ROUND_CAPS[roundKey];
  const current = team.scores[roundKey] || 0;
  const actual  = cap == null ? delta : Math.max(0, Math.min(delta, cap - current));
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
    text = `${teamName}，答对，得${scoreToSpeech(Math.abs(delta))}`;
  } else if (reason === 'partial') {
    text = `${teamName}，部分答对，得${scoreToSpeech(Math.abs(delta))}`;
  } else if (reason === 'wrong') {
    text = `${teamName}，答错，${delta < 0 ? '扣' + scoreToSpeech(Math.abs(delta)) : '不得分'}`;
  } else if (reason === 'timeout') {
    text = `${teamName}，超时，不得分`;
  } else if (reason === 'violation') {
    text = `${teamName}，抢答违规，扣${scoreToSpeech(Math.abs(delta))}`;
  } else if (reason === 'spot') {
    text = `找对一处，得一分`;
  } else if (reason === 'flower_valid') {
    text = `${teamName}，有效，得一分`;
  } else if (reason === 'flower_winner') {
    text = `${teamName}，本题擂主，额外得三分`;
  } else if (reason === 'adjust') {
    text = delta >= 0
      ? `已为${teamName}加${scoreToSpeech(Math.abs(delta))}`
      : `已为${teamName}扣${scoreToSpeech(Math.abs(delta))}`;
  }
  if (text) speak(text, { onend: callback });
  else callback?.();
}

/** 将题目组装为 TTS 朗读片段 */
function buildQuestionSegments(q) {
  if (!q) return [];
  const segs = [];
  if (state.tts.readOptions?.readStem !== false) {
    segs.push(q.stem || '');
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

/** 锁定出场顺序 */
function lockDrawOrder() {
  if (!state.draw.teamOrder.length) return false;
  state.draw.orderLocked = true;
  state.draw.log.push({ type:'lock_order', ts: Date.now() });
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
function initCardDeck(round) {
  if (!state.cardFlip.rounds[round]) return false;
  let cards = [];
  if (round === 1) {
    const pool = state.questions.filter(q => q.round === 1);
    const shuffled = fisherYates(pool).slice(0, 40);
    cards = shuffled.map((q, i) => ({
      id:       `r1_${i}`,
      cardNum:  i + 1,
      qId:      q.id,
      revealed: false,
      used:     false,
    }));
  } else if (round === 2) {
    const pool = state.questions.filter(q => q.round === 2);
    const shuffled = fisherYates(pool);
    cards = shuffled.map((q, i) => ({
      id:      `r2_${i}`,
      cardNum: i + 1,
      qId:     q.id,
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
 * correct: boolean
 */
function scoreR1(correct) {
  const team = getTeamByIdx(state.r1.currentTeamIdx);
  if (!team) return null;
  const memberIdx = state.r1.currentMemberIdx;
  const qIdx      = state.r1.currentQIdx;
  const q         = qIdx != null ? state.questions[qIdx] : null;
  const baseScore = q?.score_correct ?? 2.5;
  const delta     = correct ? baseScore : 0;

  const actual = applyTeamScore(team.id, 'r1', delta);
  team.memberScores[memberIdx] = (team.memberScores[memberIdx] || 0) + actual;

  const event = {
    round:      1,
    teamId:     team.id,
    teamName:   team.name,
    memberIdx,
    memberName: team.members[memberIdx],
    correct,
    delta:      actual,
    reason:     correct ? 'correct' : 'wrong',
    qId:        q?.id,
    ts:         Date.now(),
  };
  logEvent(event);
  return event;
}

// =====================================================
// 第二环节 — 团队共答
// =====================================================

function initR2() {
  state.currentRound = 2;
  state.roundPhase   = 'running';
  state.r2.currentQIdx = null;
  state.r2.usedQIds    = [];
  state.r2.answers     = {};
  state.showAnswerOnDisplay = false;
  state.showScoresOnDisplay = false;
  resetTimer();
  save();
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
  // 扣分
  applyTeamScore(team.id, 'r3', -2);
  const event = {
    round: 3, teamId: team.id, teamName: team.name,
    correct: false, delta: -2, reason: 'violation',
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

/**
 * 评委勾选找茬点
 * spotKey: string（找茬点标识）
 * found:   boolean
 */
function r4JudgeSpot(spotKey, found) {
  state.r4.spotJudge[spotKey] = found;
  save();
}

/** 评委现场认定额外找茬点 */
function r4AddExtraSpot(desc) {
  state.r4.extraSpots.push({ desc, ts: Date.now() });
  save();
}

/**
 * 第四环节结算（一次性）
 * teamIdx: 队伍在出场顺序中的索引
 */
function scoreR4(teamIdx) {
  const team = getTeamByIdx(teamIdx);
  if (!team) return null;
  const found  = Object.values(state.r4.spotJudge).filter(Boolean).length
                 + state.r4.extraSpots.length;
  const actual = applyTeamScore(team.id, 'r4', Math.min(found, ROUND_CAPS.r4));
  const event = {
    round: 4, teamId: team.id, teamName: team.name,
    correct: actual > 0, delta: actual, reason: 'spot',
    foundCount: found, ts: Date.now(),
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

/** 开始新令题 */
function r5StartTheme(themeIdx) {
  state.r5.currentThemeIdx = themeIdx;
  state.r5.currentTurnIdx  = 0;
  state.r5.activeTeams     = [...state.r5.teamOrder];
  state.r5.usedAnswers     = [];
  save();
}

/**
 * 有效答案（评委点确认）
 * teamId: 当前答题队伍
 * answer: string 有效内容
 */
function r5ValidAnswer(teamId, answer) {
  const team = getTeam(teamId);
  if (!team) return null;
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
