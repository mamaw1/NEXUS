/*
 * ═══════════════════════════════════════════════════════════════════
 *  bot_rotation.js — محرك دوران الحسابات
 * ═══════════════════════════════════════════════════════════════════
 *
 *  المسؤوليات:
 *  ─────────────────────────────────────────────────────────────────
 *  1. تحديد الكوكيز المناسبة لتسجيل الدخول (DB → env var)
 *  2. تتبع الحساب النشط حالياً
 *  3. وضع علامة فشل على الحساب المعطّل
 *  4. الانتقال التلقائي إلى الحساب التالي
 *  5. التبديل التلقائي الدوري بحسب مدة يحددها الأدمن
 * ═══════════════════════════════════════════════════════════════════
 */

const { getBots, getBotConfig, setBotConfig, getDB } = require('./database');

let _currentBotId   = null;
let _autoRotateTimer = null;
let _restartBotFn   = null;

// ───── كوكيز المتغير البيئي ─────────────────────────────────────────

function getEnvCookies() {
  const raw = process.env.FB_COOKIES;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function getEnvCUser() {
  const c = getEnvCookies();
  if (!c) return null;
  const cu = c.find(x => x.key === 'c_user');
  return cu ? String(cu.value) : null;
}

// ───── اختيار الكوكيز الصحيحة ──────────────────────────────────────
/*
 *  الأولوية:
 *  1. الحساب النشط (activeBotId) إن لم يكن مُعطَّلاً
 *  2. أول حساب غير مُعطَّل في القائمة
 *  3. المتغير البيئي — فقط إن كان c_user مختلفاً عن جميع حسابات DB
 *  4. null → توقف البوت
 */
async function resolveLoginCookies() {
  let bots = [];
  try { bots = await getBots(); } catch (e) {}

  const activeBotId = await getBotConfig('activeBotId').catch(() => null);

  // ── طلب صريح: استخدم المتغير البيئي (sentinel = 'ENV') ──────────
  if (activeBotId === 'ENV') {
    const envCookies = getEnvCookies();
    if (envCookies && envCookies.length > 0) {
      _currentBotId = null;
      return { cookies: envCookies, botId: null, botName: 'المتغير البيئي' };
    }
    // المتغير البيئي غير متاح — امسح الـ sentinel وجرّب DB
    await setBotConfig('activeBotId', null).catch(() => {});
  }

  if (bots.length > 0) {
    // حاول الحساب النشط أولاً (يتجاهل null و'ENV')
    if (activeBotId && activeBotId !== 'ENV') {
      const active = bots.find(
        b => String(b._id) === String(activeBotId) && b.status !== 'failed'
      );
      if (active && active.cookies && active.cookies.length > 0) {
        _currentBotId = String(active._id);
        return { cookies: active.cookies, botId: _currentBotId, botName: active.name };
      }
    }

    // جرّب أول حساب غير مُعطَّل
    for (const bot of bots) {
      if (bot.status === 'failed' || bot.status === 'disabled') continue;
      if (!bot.cookies || !bot.cookies.length) continue;
      _currentBotId = String(bot._id);
      await setBotConfig('activeBotId', _currentBotId).catch(() => {});
      return { cookies: bot.cookies, botId: _currentBotId, botName: bot.name };
    }
  }

  // جميع حسابات DB فشلت — جرّب المتغير البيئي كـ fallback
  const envCookies = getEnvCookies();
  if (envCookies && envCookies.length > 0) {
    const envCUser = getEnvCUser();

    // تحقق أن المتغير البيئي ليس نسخة من حساب مُعطَّل موجود في DB
    const matchedFailed = bots.find(b => {
      const cu = b.cookies && b.cookies.find(x => x.key === 'c_user');
      return cu && String(cu.value) === envCUser && b.status === 'failed';
    });

    if (!matchedFailed) {
      _currentBotId = null;
      return { cookies: envCookies, botId: null, botName: 'المتغير البيئي' };
    }
  }

  return null; // لا يوجد شيء يعمل
}

// ───── إدارة حالة الحسابات ─────────────────────────────────────────

async function markBotFailed(botId) {
  if (!botId) return;
  try {
    const { ObjectId } = require('mongodb');
    await getDB().collection('bots').updateOne(
      { _id: new ObjectId(String(botId)) },
      { $set: { status: 'failed', failedAt: new Date() } }
    );
  } catch (e) {
    console.error('markBotFailed error:', e.message);
  }
}

async function markBotActive(botId) {
  if (!botId) return;
  try {
    const { ObjectId } = require('mongodb');
    await getDB().collection('bots').updateOne(
      { _id: new ObjectId(String(botId)) },
      { $set: { status: 'active', failedAt: null } }
    );
  } catch (e) {}
}

// ───── التنقل بين الحسابات ─────────────────────────────────────────

async function getNextBot(currentBotId) {
  let bots = [];
  try { bots = await getBots(); } catch (e) {}
  const active = bots.filter(
    b => b.status !== 'failed' && b.status !== 'disabled' && b.cookies && b.cookies.length > 0
  );
  if (!active.length) return null;
  if (!currentBotId || active.length === 1) return active[0];
  const idx = active.findIndex(b => String(b._id) === String(currentBotId));
  if (idx === -1) return active[0];
  return active[(idx + 1) % active.length];
}

function getCurrentBotId()    { return _currentBotId; }
function setCurrentBotId(id)  { _currentBotId = id ? String(id) : null; }

async function switchToBot(botId) {
  _currentBotId = botId ? String(botId) : null;
  await setBotConfig('activeBotId', _currentBotId).catch(() => {});
}

// ───── التبديل التلقائي ─────────────────────────────────────────────

function _scheduleAutoRotate(minutes) {
  if (_autoRotateTimer) clearInterval(_autoRotateTimer);
  _autoRotateTimer = setInterval(async () => {
    try {
      const next = await getNextBot(_currentBotId);
      if (!next) return;
      const nextId = String(next._id);
      if (nextId === _currentBotId) return;
      _currentBotId = nextId;
      await setBotConfig('activeBotId', nextId).catch(() => {});
      if (_restartBotFn) _restartBotFn();
    } catch (e) {
      console.error('autoRotate error:', e.message);
    }
  }, minutes * 60 * 1000);
}

async function startAutoRotation(minutes, restartFn) {
  stopAutoRotationSync();
  _restartBotFn = restartFn;
  await setBotConfig('autoRotateEnabled', true).catch(() => {});
  await setBotConfig('autoRotateMinutes', Number(minutes)).catch(() => {});
  _scheduleAutoRotate(Number(minutes));
}

async function stopAutoRotation() {
  stopAutoRotationSync();
  await setBotConfig('autoRotateEnabled', false).catch(() => {});
}

function stopAutoRotationSync() {
  if (_autoRotateTimer) { clearInterval(_autoRotateTimer); _autoRotateTimer = null; }
}

async function initAutoRotation(restartFn) {
  _restartBotFn = restartFn;
  try {
    const enabled = await getBotConfig('autoRotateEnabled');
    const minutes = await getBotConfig('autoRotateMinutes');
    if (enabled && minutes && Number(minutes) > 0) {
      _scheduleAutoRotate(Number(minutes));
      console.log(`[Rotation] التبديل التلقائي نشط — كل ${minutes} دقيقة`);
    }
  } catch (e) {}
}

function isAutoRotateActive() { return _autoRotateTimer !== null; }

// ───── إطلاق إعادة التشغيل من أي مكان ──────────────────────────────
// يُستدعى من admin2.js بدلاً من process.exit(0)
function triggerRestart() {
  if (typeof _restartBotFn === 'function') {
    _restartBotFn();
  } else {
    // fallback احتياطي فقط إن لم تُضبط الدالة بعد
    setTimeout(() => process.exit(0), 500);
  }
}

// ───── اسم حساب المتغير البيئي ──────────────────────────────────────

async function getEnvBotName() {
  try {
    const saved = await getBotConfig('envBotName');
    if (saved) return saved;
  } catch (e) {}
  const cu = getEnvCUser();
  return cu ? `المتغير البيئي (${cu})` : 'المتغير البيئي';
}

async function setEnvBotName(name) {
  try { await setBotConfig('envBotName', name); } catch (e) {}
}

module.exports = {
  resolveLoginCookies,
  markBotFailed,
  markBotActive,
  getNextBot,
  getCurrentBotId,
  setCurrentBotId,
  switchToBot,
  startAutoRotation,
  stopAutoRotation,
  stopAutoRotationSync,
  initAutoRotation,
  isAutoRotateActive,
  getEnvCookies,
  getEnvCUser,
  getEnvBotName,
  setEnvBotName,
  triggerRestart,
};
