/*
 * ═══════════════════════════════════════════════════════════════════════
 *  الجزء الثاني: admin2.js — إدارة النظام والبوت
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  الوظائف والمحتويات:
 *  ───────────────────────────────────────────────────────────────────
 *  1. حالة البوت       : تشغيل البوت / ايقاف البوت بالكامل
 *  2. البوتات          : عرض البوتات، إضافة بوت، تعديل الكوكيز
 *  3. تبديل            : التبديل بين البوتات + حفظ خيط الإشعار
 *  4. اعادة ضبط        : إعادة الكنيات وأسماء وصور القروبات
 *  5. الحماية          : حماية الكنيات والأسماء والصور — مُصلَحة كلياً
 *                         بآلية _protectionLocks لمنع الحلقات اللانهائية
 *  6. ريست             : إعادة تشغيل + حفظ خيط الإشعار في DB
 *  7. قاعدة البيانات   : عرض المحتويات والمساحة وحذف الأقسام
 *  8. القروبات         : عرض وتعديل ايديهات الممالك
 *  9. الذكاء الاصطناعي : إضافة/تعديل/حذف الوكلاء وإدارة ذاكرتهم
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs   = require('fs');
const path = require('path');
const config = require('./config.json');

const {
  sendMessage, kingdomNamesAr, generateNickname, getKingdomByThreadId
} = require('./utils');

const {
  getAllPlayers,
  getAdminSession, setAdminSession, deleteAdminSession,
  getBots, addBot, updateBotCookies, getBotById, updateBotName, deleteBot,
  getGroupSetting, updateGroupSetting,
  getProtectionSettings, saveProtectionSettings,
  getProtectedState, saveProtectedState,
  getDB,
  getAllAgents, getAgentByName, addAgent, updateAgent, deleteAgent,
  clearAgentConversationsByName, clearAllAgentConversations, countAgentConversations,
  getBotConfig, setBotConfig,
} = require('./database');

const {
  markBotActive,
  startAutoRotation,
  stopAutoRotation,
  isAutoRotateActive,
  switchToBot,
  getCurrentBotId,
  getEnvCUser,
  getEnvCookies,
  getEnvBotName,
  setEnvBotName,
  triggerRestart,
} = require('./bot_rotation');

const { handleManshourat, handleManshouraatSession } = require('./nashr');

// ─────────────────────────────────────────────────────────────────────
//   أدوات مساعدة محلية
// ─────────────────────────────────────────────────────────────────────

function setTitle(api, title, threadID) {
  return new Promise((resolve) => {
    try { api.setTitle(title, threadID, () => resolve()); }
    catch (e) { resolve(); }
  });
}

function downloadPhoto(url, dest, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
    const proto = url.startsWith('https') ? require('https') : require('http');
    const file  = fs.createWriteStream(dest);
    proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if ([301, 302, 307].includes(res.statusCode)) {
        file.close(); try { fs.unlinkSync(dest); } catch (_) {}
        return downloadPhoto(res.headers.location, dest, maxRedirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close(); try { fs.unlinkSync(dest); } catch (_) {}
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (err) => { file.close(); try { fs.unlinkSync(dest); } catch (_) {} reject(err); });
    }).on('error', (err) => { file.close(); try { fs.unlinkSync(dest); } catch (_) {} reject(err); });
  });
}

// ═════════════════════════════════════════════════════════════════════
//   1. حالة البوت (تشغيل / ايقاف)
// ═════════════════════════════════════════════════════════════════════

let _botEnabled = true;

async function initBotEnabled() {
  try {
    const stored = await getBotConfig('botEnabled');
    _botEnabled = (stored === null || stored === undefined) ? true : Boolean(stored);
  } catch (e) { _botEnabled = true; }
}

function isBotEnabled() { return _botEnabled; }

async function handleBotStop(api, event) {
  _botEnabled = false;
  try { await setBotConfig('botEnabled', false); } catch (e) {}
  await sendMessage(api,
    `╮───∙⋆⋅「 ايقاف البوت 」\n│\n│ › تم ايقاف البوت 🔴\n│ › البوت لن يستجيب لأي أمر الآن\n│ › ارسل 《 تشغيل البوت 》 لإعادة تشغيله\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    event.threadID);
}

async function handleBotStart(api, event) {
  _botEnabled = true;
  try { await setBotConfig('botEnabled', true); } catch (e) {}
  await sendMessage(api,
    `╮───∙⋆⋅「 تشغيل البوت 」\n│\n│ › تم تشغيل البوت 🟢\n│ › البوت نشط الآن ويستجيب للأوامر\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    event.threadID);
}

// ═════════════════════════════════════════════════════════════════════
//   2. البوتات
// ═════════════════════════════════════════════════════════════════════

// يُرجع true إذا كان المتغير البيئي شغّالاً وغير موجود كـ DB bot
function _envIsAlone(bots, envCUser) {
  if (!envCUser || !getEnvCookies()) return false;
  return !bots.some(b => {
    const cu = b.cookies && (b.cookies.find(x => x.key === 'c_user') || {}).value;
    return cu && String(cu) === envCUser;
  });
}

async function buildBotaatMsg(bots) {
  const activeBotId  = await getBotConfig('activeBotId').catch(() => null);
  const autoEnabled  = await getBotConfig('autoRotateEnabled').catch(() => false);
  const autoMinutes  = await getBotConfig('autoRotateMinutes').catch(() => 0);
  const envCUser     = getEnvCUser();
  const showEnv      = _envIsAlone(bots, envCUser);
  const envName      = showEnv ? await getEnvBotName() : null;

  // المصدر الحقيقي: الذاكرة أولاً
  const runningBotId = getCurrentBotId();
  const currentId    = runningBotId || activeBotId;

  let msg = `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n        ✦  البوتات  ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n`;
  msg += `╮───∙⋆⋅「 القائمة 」\n│\n`;

  let counter = 1;

  bots.forEach(b => {
    const isActive = currentId && currentId !== 'ENV' && String(b._id) === String(currentId);
    const isFailed = b.status === 'failed';
    let tag = '';
    if (isActive)  tag = ' ✦ الحالي';
    else if (isFailed) tag = ' ⛔ فشل';
    msg += `│ ${counter++}. ${b.name}${tag}\n`;
  });

  if (showEnv) {
    const isEnvActive = (!runningBotId && (!activeBotId || activeBotId === 'ENV')) || activeBotId === 'ENV';
    msg += `│ ${counter++}. ${envName}${isEnvActive ? ' ✦ الحالي' : ''} 📌\n`;
  }

  if (bots.length === 0 && !showEnv) msg += `│ › لا يوجد بوتات مضافة بعد\n`;

  const rotateStr = autoEnabled ? `🟢 كل ${autoMinutes} دقيقة` : '🔴 معطّل';
  msg += `│\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n`;
  msg += `╮───∙⋆⋅「 التبديل التلقائي 」\n│ › الحالة : ${rotateStr}\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n`;
  msg += `╮───∙⋆⋅「 الخيارات 」\n│ › ارسل رقم البوت لإدارته\n│ › ارسل 《 إضافة 》 لإضافة بوت جديد\n│ › ارسل 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
  return msg;
}

async function handleBotaat(api, event) {
  const { threadID, senderID } = event;
  const bots    = await getBots();
  const envCUser = getEnvCUser();
  const showEnv  = _envIsAlone(bots, envCUser);
  const envName  = showEnv ? await getEnvBotName() : null;

  const sessionBots = bots.map(b => ({ _id: String(b._id), name: b.name, status: b.status || 'active', isEnv: false }));
  if (showEnv) sessionBots.push({ _id: 'ENV', name: envName, status: 'active', isEnv: true });

  await setAdminSession(senderID, { state: 'BOTAAT_MAIN', bots: sessionBots });
  await sendMessage(api, await buildBotaatMsg(bots), threadID);
}

async function handleBotaatSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();

  if (text === 'خروج') {
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }

  // ── BOTAAT_MAIN ─────────────────────────────────────────────────
  if (session.state === 'BOTAAT_MAIN') {
    if (text === 'إضافة' || text === 'اضافة') {
      await setAdminSession(senderID, { state: 'BOTAAT_ADD_NAME' });
      await sendMessage(api, `╮───∙⋆⋅「 إضافة بوت 」\n│\n│ › ارسل اسم البوت الجديد\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      return;
    }
    const bots = session.bots || [];
    const idx  = parseInt(text, 10) - 1;
    if (!isNaN(idx) && idx >= 0 && idx < bots.length) {
      const bot = bots[idx];
      await setAdminSession(senderID, { state: 'BOTAAT_BOT_MENU', selBotId: bot._id, selBotName: bot.name, selIsEnv: bot.isEnv || false });
      if (bot.isEnv) {
        // حساب المتغير البيئي — لا حذف، تعديل الاسم فقط
        await sendMessage(api,
          `╮───∙⋆⋅「 ${bot.name} 📌 」\n│\n│ 1 › تعديل الاسم\n│\n│ ⚠️ هذا الحساب موجود في المتغير البيئي\n│    ولا يمكن حذفه من هنا\n│\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
          threadID);
      } else {
        await sendMessage(api,
          `╮───∙⋆⋅「 ${bot.name} 」\n│\n│ 1 › تعديل الكوكيز\n│ 2 › تعديل الاسم\n│ 3 › حذف البوت\n│\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
          threadID);
      }
      return;
    }
    await sendMessage(api, `⚠️ ارسل رقم بوت، او 《 إضافة 》، او 《 خروج 》`, threadID);
    return;
  }

  // ── BOTAAT_BOT_MENU ─────────────────────────────────────────────
  if (session.state === 'BOTAAT_BOT_MENU') {
    const isEnv = session.selIsEnv || false;

    // حساب المتغير البيئي: خيار 1 = تعديل الاسم فقط
    if (isEnv) {
      if (text === '1') {
        await setAdminSession(senderID, { state: 'BOTAAT_RENAME', renBotId: 'ENV', renBotName: session.selBotName, renIsEnv: true });
        await sendMessage(api, `╮───∙⋆⋅「 تعديل اسم 📌 › ${session.selBotName} 」\n│\n│ › ارسل الاسم الجديد\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
        return;
      }
      await sendMessage(api, `⚠️ اختر 1 أو 《 خروج 》`, threadID);
      return;
    }

    if (text === '1') {
      await setAdminSession(senderID, { state: 'BOTAAT_EDIT_COOKIES', editBotId: session.selBotId, editBotName: session.selBotName });
      await sendMessage(api, `╮───∙⋆⋅「 تعديل كوكيز › ${session.selBotName} 」\n│\n│ › ارسل الكوكيز الجديدة (JSON)\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      return;
    }
    if (text === '2') {
      await setAdminSession(senderID, { state: 'BOTAAT_RENAME', renBotId: session.selBotId, renBotName: session.selBotName, renIsEnv: false });
      await sendMessage(api, `╮───∙⋆⋅「 تعديل اسم › ${session.selBotName} 」\n│\n│ › ارسل الاسم الجديد\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      return;
    }
    if (text === '3') {
      await setAdminSession(senderID, { state: 'BOTAAT_DELETE_CONFIRM', delBotId: session.selBotId, delBotName: session.selBotName });
      await sendMessage(api,
        `╮───∙⋆⋅「 حذف بوت 」\n│\n│ › البوت : ${session.selBotName}\n│\n│ › ارسل 《 تأكيد 》 للحذف\n│ › او 《 خروج 》 للإلغاء\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        threadID);
      return;
    }
    await sendMessage(api, `⚠️ اختر 1 أو 2 أو 3 أو 《 خروج 》`, threadID);
    return;
  }

  // ── BOTAAT_ADD_NAME ─────────────────────────────────────────────
  if (session.state === 'BOTAAT_ADD_NAME') {
    await setAdminSession(senderID, { state: 'BOTAAT_ADD_COOKIES', newBotName: text });
    await sendMessage(api, `╮───∙⋆⋅「 ${text} 」\n│\n│ › ارسل الكوكيز الخاصة بهذا البوت (JSON)\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }

  // ── BOTAAT_ADD_COOKIES ──────────────────────────────────────────
  if (session.state === 'BOTAAT_ADD_COOKIES') {
    try {
      const c = JSON.parse(text);
      await addBot(session.newBotName, c);
      await deleteAdminSession(senderID);
      await sendMessage(api, `╮───∙⋆⋅「 تمت الإضافة ✅️ 」\n│\n│ › ${session.newBotName}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    } catch (e) {
      await sendMessage(api, `⚠️ الكوكيز غير صالحة، تأكد أنها JSON صحيح`, threadID);
    }
    return;
  }

  // ── BOTAAT_EDIT_COOKIES ─────────────────────────────────────────
  if (session.state === 'BOTAAT_EDIT_COOKIES') {
    try {
      const c = JSON.parse(text);
      await updateBotCookies(session.editBotId, c);
      await markBotActive(session.editBotId);
      await deleteAdminSession(senderID);
      await sendMessage(api, `╮───∙⋆⋅「 تم التعديل ✅️ 」\n│\n│ › ${session.editBotName}\n│ › تم تفعيله مجدداً 🟢\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    } catch (e) {
      await sendMessage(api, `⚠️ الكوكيز غير صالحة، تأكد أنها JSON صحيح`, threadID);
    }
    return;
  }

  // ── BOTAAT_RENAME ───────────────────────────────────────────────
  if (session.state === 'BOTAAT_RENAME') {
    if (!text || text.length < 1) { await sendMessage(api, `⚠️ الاسم قصير جداً`, threadID); return; }
    if (session.renIsEnv) {
      await setEnvBotName(text);
    } else {
      await updateBotName(session.renBotId, text);
    }
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم تعديل الاسم ✅️ 」\n│\n│ › القديم : ${session.renBotName}\n│ › الجديد : ${text}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }

  // ── BOTAAT_DELETE_CONFIRM ───────────────────────────────────────
  if (session.state === 'BOTAAT_DELETE_CONFIRM') {
    if (text === 'تأكيد') {
      await deleteBot(session.delBotId);
      const activeBotId = await getBotConfig('activeBotId').catch(() => null);
      if (activeBotId && String(activeBotId) === String(session.delBotId)) {
        await setBotConfig('activeBotId', null).catch(() => {});
      }
      await deleteAdminSession(senderID);
      await sendMessage(api, `╮───∙⋆⋅「 تم الحذف 🗑️ 」\n│\n│ › ${session.delBotName}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    } else {
      await deleteAdminSession(senderID);
      await sendMessage(api, `╮───∙⋆⋅「 إلغاء 」\n│\n│ › تم إلغاء الحذف\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    }
    return;
  }
}

// ═════════════════════════════════════════════════════════════════════
//   3. تبديل البوت + التبديل التلقائي
// ═════════════════════════════════════════════════════════════════════

async function handleTabdeel(api, event) {
  const { threadID, senderID } = event;
  const bots        = await getBots();
  const autoEnabled = await getBotConfig('autoRotateEnabled').catch(() => false);
  const autoMinutes = await getBotConfig('autoRotateMinutes').catch(() => 0);
  const envCUser    = getEnvCUser();
  const showEnv     = _envIsAlone(bots, envCUser);
  const envName     = showEnv ? await getEnvBotName() : null;

  // المصدر الحقيقي: الحساب الجاري فعلاً في الذاكرة
  const runningBotId = getCurrentBotId(); // null = المتغير البيئي أو لم يُحدَّد بعد
  const activeBotId  = await getBotConfig('activeBotId').catch(() => null);
  // استخدام القيمة الأدق: الذاكرة أولاً، ثم DB
  const currentId = runningBotId || activeBotId;

  let msg = `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n      ✦  تبديل البوت  ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n`;
  msg += `╮───∙⋆⋅「 البوتات 」\n│\n`;

  let counter = 1;
  bots.forEach(b => {
    const isActive = currentId && currentId !== 'ENV' && String(b._id) === String(currentId);
    const isFailed = b.status === 'failed';
    let tag = '';
    if (isActive) tag = ' ✦ الحالي';
    else if (isFailed) tag = ' ⛔ فشل';
    msg += `│ ${counter++}. ${b.name}${tag}\n`;
  });

  if (showEnv) {
    // ENV نشط فقط إذا لا يوجد حساب DB جارٍ في الذاكرة
    const isEnvActive = !runningBotId && (!activeBotId || activeBotId === 'ENV');
    msg += `│ ${counter++}. ${envName}${isEnvActive ? ' ✦ الحالي' : ''} 📌\n`;
  }

  if (bots.length === 0 && !showEnv) msg += `│ › لا يوجد بوتات\n`;
  msg += `│\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n`;

  const rotateStr = autoEnabled ? `🟢 مُفعّل — كل ${autoMinutes} دقيقة` : '🔴 معطّل';
  msg += `╮───∙⋆⋅「 التبديل التلقائي 」\n│ › ${rotateStr}\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n`;
  msg += `╮───∙⋆⋅「 الخيارات 」\n│ › ارسل رقم البوت للتبديل اليدوي\n│ › 《 تلقائي [دقائق] 》 — تفعيل التبديل التلقائي\n│ › 《 إيقاف تلقائي 》 — إيقاف التبديل التلقائي\n│ › 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`;

  const sessionBots = bots.map(b => ({ _id: String(b._id), name: b.name, status: b.status || 'active', isEnv: false }));
  if (showEnv) sessionBots.push({ _id: 'ENV', name: envName, status: 'active', isEnv: true });

  await setAdminSession(senderID, { state: 'TABDEEL_SELECT', bots: sessionBots });
  await sendMessage(api, msg, threadID);
}

async function handleTabdeelSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();

  if (text === 'خروج') {
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }

  // إيقاف التبديل التلقائي
  if (text === 'إيقاف تلقائي' || text === 'ايقاف تلقائي') {
    await stopAutoRotation();
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 التبديل التلقائي 」\n│\n│ › تم الإيقاف 🔴\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }

  // تفعيل التبديل التلقائي: "تلقائي 30"
  const autoMatch = text.match(/^تلقائي\s+(\d+)$/);
  if (autoMatch) {
    const minutes = parseInt(autoMatch[1], 10);
    if (minutes < 1 || minutes > 10080) {
      await sendMessage(api, `⚠️ المدة يجب أن تكون بين 1 و 10080 دقيقة`, threadID);
      return;
    }
    const bots = await getBots();
    const active = bots.filter(b => b.status !== 'failed' && b.cookies && b.cookies.length > 0);
    if (active.length < 2) {
      await sendMessage(api, `⚠️ يجب وجود حسابين صالحين على الأقل للتبديل التلقائي`, threadID);
      return;
    }
    await startAutoRotation(minutes, () => triggerRestart());
    await deleteAdminSession(senderID);
    await sendMessage(api,
      `╮───∙⋆⋅「 التبديل التلقائي 」\n│\n│ › تم التفعيل 🟢\n│ › سيتم التبديل كل ${minutes} دقيقة\n│ › عدد الحسابات : ${active.length}\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }

  // تبديل يدوي برقم
  const bots = session.bots || [];
  const idx  = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= bots.length) {
    await sendMessage(api, `⚠️ ارسل رقم بوت، او 《 تلقائي [دقائق] 》، او 《 إيقاف تلقائي 》، او 《 خروج 》`, threadID);
    return;
  }

  const bot = bots[idx];

  // المصدر الحقيقي للحساب الجاري
  const runningBotId = getCurrentBotId();
  const activeBotId  = await getBotConfig('activeBotId').catch(() => null);

  // حساب المتغير البيئي (ENV)
  if (bot.isEnv) {
    const isEnvRunning = !runningBotId && (!activeBotId || activeBotId === 'ENV');
    if (isEnvRunning) {
      await deleteAdminSession(senderID);
      await sendMessage(api, `╮───∙⋆⋅「 تبديل 」\n│\n│ › ${bot.name} هو الحساب المستخدم حالياً ✦ 📌\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      return;
    }
    // التبديل لحساب المتغير البيئي
    await setBotConfig('activeBotId', 'ENV').catch(() => {});
    await setBotConfig('restartNotifyThread', threadID);
    await deleteAdminSession(senderID);
    await sendMessage(api,
      `╮───∙⋆⋅「 تبديل البوت 」\n│\n│ › تم الاختيار : ${bot.name} 📌\n│ › جارِ إعادة التشغيل... ⟳\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    setTimeout(() => triggerRestart(), 1500);
    return;
  }

  // هل الحساب المختار هو نفسه الجاري فعلاً؟
  const isAlreadyRunning = runningBotId && String(runningBotId) === String(bot._id);
  if (isAlreadyRunning) {
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تبديل 」\n│\n│ › ${bot.name} هو الحساب المستخدم حالياً ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }

  await switchToBot(bot._id);
  await setBotConfig('restartNotifyThread', threadID);
  await deleteAdminSession(senderID);
  await sendMessage(api,
    `╮───∙⋆⋅「 تبديل البوت 」\n│\n│ › تم الاختيار : ${bot.name}\n│ › جارِ إعادة التشغيل... ⟳\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
  setTimeout(() => triggerRestart(), 1500);
}

// ═════════════════════════════════════════════════════════════════════
//   4. اعادة ضبط
// ═════════════════════════════════════════════════════════════════════

async function handleEadatDabt(api, event) {
  const { threadID } = event;
  await sendMessage(api, `╮───∙⋆⋅「 إعادة ضبط 」\n│\n│ › جارِ إعادة ضبط الكنيات وأسماء القروبات...\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
  const players = await getAllPlayers();
  let done = 0;
  for (const p of players) {
    const groupId = config.groupes[p.kingdom]; if (!groupId) continue;
    try { const nn = generateNickname(p.nickname, p.rank || 'مجند', p.class); await new Promise(r => api.changeNickname(nn, groupId, String(p.fbId), () => r())); done++; } catch (e) {}
  }
  for (const k of ['solfare', 'niravil', 'murdak']) {
    const setting = await getGroupSetting(k);
    const defaultName = (setting && setting.defaultName) ? setting.defaultName : `مملكة ${kingdomNamesAr[k]}`;
    await updateGroupSetting(k, { customName: defaultName });
    const gid = config.groupes[k];
    if (gid) { try { await setTitle(api, defaultName, gid); } catch (e) {} }
    if (setting && setting.defaultPhotoUrl && gid) {
      try {
        const tmp = path.join(require('os').tmpdir(), `reset_${k}_${Date.now()}.jpg`);
        await downloadPhoto(setting.defaultPhotoUrl, tmp);
        await new Promise(r => api.changeGroupImage(fs.createReadStream(tmp), gid, () => { try { fs.unlinkSync(tmp); } catch (_) {} r(); }));
      } catch (e) {}
    }
  }
  await sendMessage(api, `╮───∙⋆⋅「 تم إعادة الضبط 」\n│\n│ › كنيات مُعادة : ${done}\n│ › أسماء القروبات : تمت إعادتها ✅️\n│ › صور القروبات : تمت إعادتها ✅️\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
}

// ═════════════════════════════════════════════════════════════════════
//   5. الحماية — مُصلَحة كلياً مع منع الحلقات اللانهائية
// ═════════════════════════════════════════════════════════════════════

/*
 *  سبب عدم عمل الحماية سابقاً:
 *  ────────────────────────────────────────────────────────────────
 *  1. حلقة لانهائية: عندما يُعيد البوت تعيين الكنية/الاسم/الصورة،
 *     يُطلق فيسبوك حدثاً جديداً، فيستدعي handleProtection مرة أخرى،
 *     وهكذا إلى ما لا نهاية. فحص event.author لم يكن كافياً لأن
 *     fca-unofficial لا يُعيّن author دائماً بشكل موثوق.
 *
 *  2. مقارنة القيمة: لم يكن هناك فحص هل القيمة الجديدة تختلف
 *     عن المحمية، فكان البوت يتدخل حتى حين لا داعي لذلك.
 *
 *  الحل:
 *  ────────────────────────────────────────────────────────────────
 *  _protectionLocks: Set يحتفظ بمفاتيح العناصر قيد المعالجة.
 *  أي حدث بنفس المفتاح خلال نافذة زمنية (6-12 ثانية) يُتجاهَل.
 *  هذا يمنع الحلقة بغض النظر عن قيمة event.author.
 */

const _protectionLocks = new Set();

function _lock(key, ms) {
  _protectionLocks.add(key);
  setTimeout(() => _protectionLocks.delete(key), ms);
}

// ─── لقطات الحالة الحالية ───────────────────────────────────────────

async function snapshotNicknames() {
  const players = await getAllPlayers();
  const snap    = {};
  for (const p of players) {
    snap[String(p.fbId)] = generateNickname(p.nickname, p.rank || 'مجند', p.class);
  }
  const existing = await getProtectedState('global') || {};
  await saveProtectedState('global', { ...existing, nicknames: snap });
}

async function snapshotGroupNames() {
  const snap = {};
  for (const k of ['solfare', 'niravil', 'murdak']) {
    const setting = await getGroupSetting(k);
    snap[k] = (setting && setting.customName) ? setting.customName : `مملكة ${kingdomNamesAr[k]}`;
  }
  const existing = await getProtectedState('global') || {};
  await saveProtectedState('global', { ...existing, groupNames: snap });
}

async function snapshotGroupPhotos() {
  const snap = {};
  for (const k of ['solfare', 'niravil', 'murdak']) {
    const setting = await getGroupSetting(k);
    const base64 = setting && setting.photoBase64;
    const url    = setting && (setting.defaultPhotoUrl || setting.photoUrl);
    if (base64) snap[k] = { base64, url };
    else if (url) snap[k] = { url };
    else console.warn(`[حماية] ⚠️ لا توجد صورة محفوظة لـ ${k}`);
  }
  const existing = await getProtectedState('global') || {};
  await saveProtectedState('global', { ...existing, groupPhotos: snap });
}

// ─── المعالج الرئيسي ────────────────────────────────────────────────

async function handleProtection(api, event, botId) {
  let settings, state;
  try { settings = await getProtectionSettings('global'); state = await getProtectedState('global'); } catch (e) { return; }
  if (!settings || !state) return;

  // استخرج منفِّذ الحدث من أكثر من حقل (fca-unofficial يتفاوت)
  const eventAuthor = String(
    event.author ||
    (event.logMessageData && event.logMessageData.actorFbId) ||
    ''
  );

  // ══════════ حماية الكنيات ══════════
  if (settings.nicknames && event.logMessageType === 'log:user-nickname') {
    if (!state.nicknames) return;

    const changedId     = String((event.logMessageData && event.logMessageData.participant_id) || '');
    if (!changedId) return;

    const protectedNick = state.nicknames[changedId];
    if (!protectedNick) return;

    // الكنية التي وضعها الشخص الآن
    const newNick = String((event.logMessageData && event.logMessageData.nickname) || '');

    // إذا كانت الكنية صحيحة → لا تتدخل
    if (newNick === protectedNick) return;

    // إذا كان البوت نفسه هو من غيّرها → لا تتدخل
    if (botId && eventAuthor && eventAuthor === String(botId)) return;

    // مانع الحلقة
    const lockKey = `nick_${changedId}`;
    if (_protectionLocks.has(lockKey)) return;
    _lock(lockKey, 6000);

    try {
      await new Promise((resolve) => {
        api.changeNickname(protectedNick, event.threadID, changedId, () => resolve());
      });
    } catch (e) { console.error('❌ خطأ حماية الكنية:', e.message || e); }
    return;
  }

  // ══════════ حماية أسماء القروبات ══════════
  if (settings.groupNames && event.logMessageType === 'log:thread-name') {
    if (!state.groupNames) return;

    const kingdom = getKingdomByThreadId(event.threadID);
    if (!kingdom) return;

    const protectedName = state.groupNames[kingdom];
    if (!protectedName) return;

    // الاسم الجديد الذي وضعه الشخص
    const newName = String((event.logMessageData && event.logMessageData.name) || '');

    if (newName === protectedName) return;
    if (botId && eventAuthor && eventAuthor === String(botId)) return;

    const lockKey = `name_${event.threadID}`;
    if (_protectionLocks.has(lockKey)) return;
    _lock(lockKey, 6000);

    try { await setTitle(api, protectedName, event.threadID); }
    catch (e) { console.error('❌ خطأ حماية الاسم:', e.message || e); }
    return;
  }

  // ══════════ حماية صور القروبات ══════════
  if (settings.groupPhotos && event.logMessageType === 'log:thread-image') {
    console.log(`[حماية صورة] حدث تغيير صورة في ${event.threadID}`);
    if (!state.groupPhotos) { console.warn('[حماية صورة] ⚠️ state.groupPhotos غير موجود'); return; }

    const kingdom = getKingdomByThreadId(event.threadID);
    if (!kingdom) { console.warn(`[حماية صورة] ⚠️ لم يُعرَّف القروب ${event.threadID} كمملكة`); return; }

    const photoEntry = state.groupPhotos[kingdom];
    if (!photoEntry) { console.warn(`[حماية صورة] ⚠️ لا توجد صورة محفوظة لـ ${kingdom} — استخدم أمر التعديل أولاً`); return; }

    if (botId && eventAuthor && eventAuthor === String(botId)) { console.log('[حماية صورة] تجاهل: البوت هو من غيّر الصورة'); return; }

    const lockKey = `photo_${event.threadID}`;
    if (_protectionLocks.has(lockKey)) return;
    _lock(lockKey, 12000);

    const tmp = path.join(require('os').tmpdir(), `protect_photo_${Date.now()}.jpg`);
    try {
      // استخدم الـ base64 المحفوظ أولاً (لا يتأثر بانتهاء صلاحية رابط فيسبوك)
      if (photoEntry.base64) {
        fs.writeFileSync(tmp, Buffer.from(photoEntry.base64, 'base64'));
      } else if (photoEntry.url) {
        await downloadPhoto(photoEntry.url, tmp);
      } else if (typeof photoEntry === 'string') {
        // دعم الصيغة القديمة (رابط نصي مباشر)
        await downloadPhoto(photoEntry, tmp);
      } else {
        console.error('[حماية] ⚠️ لا توجد بيانات صورة محفوظة لـ', kingdom);
        _protectionLocks.delete(lockKey);
        return;
      }

      await new Promise((resolve, reject) => {
        api.changeGroupImage(fs.createReadStream(tmp), event.threadID, (err) => {
          try { fs.unlinkSync(tmp); } catch (_) {}
          if (err) return reject(err);
          resolve();
        });
      });
      console.log(`[حماية] ✅ تم استعادة صورة ${kingdom}`);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (_) {}
      console.error('❌ خطأ حماية الصورة:', e.message || e);
      _protectionLocks.delete(lockKey);
    }
    return;
  }
}

// ─── واجهة إعدادات الحماية للأدمن ──────────────────────────────────

async function handleHimaya(api, event) {
  const { threadID, senderID } = event;
  const settings = await getProtectionSettings('global') || {};
  const si = (v) => v ? '🟢' : '🔴';
  const msg =
    `╮───∙⋆⋅「 الحماية 」\n│\n` +
    `│ 1 › حماية الكنيات          ${si(settings.nicknames)}\n` +
    `│ 2 › حماية أسماء القروبات   ${si(settings.groupNames)}\n` +
    `│ 3 › حماية الصور            ${si(settings.groupPhotos)}\n` +
    `│ 4 › حماية الكل\n│ 5 › إيقاف الكل\n│ › 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
  await setAdminSession(senderID, { state: 'HIMAYA_MAIN' });
  await sendMessage(api, msg, threadID);
}

async function handleHimayaSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();
  if (text === 'خروج') { await deleteAdminSession(senderID); await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }

  const current   = await getProtectionSettings('global') || {};
  let newSettings = {
    nicknames:   current.nicknames   || false,
    groupNames:  current.groupNames  || false,
    groupPhotos: current.groupPhotos || false,
  };

  if      (text === '1') { newSettings.nicknames   = !current.nicknames;   if (newSettings.nicknames)   await snapshotNicknames();  }
  else if (text === '2') { newSettings.groupNames  = !current.groupNames;  if (newSettings.groupNames)  await snapshotGroupNames(); }
  else if (text === '3') { newSettings.groupPhotos = !current.groupPhotos; if (newSettings.groupPhotos) await snapshotGroupPhotos(); }
  else if (text === '4') {
    newSettings = { nicknames: true, groupNames: true, groupPhotos: true };
    await snapshotNicknames(); await snapshotGroupNames(); await snapshotGroupPhotos();
  }
  else if (text === '5') { newSettings = { nicknames: false, groupNames: false, groupPhotos: false }; }
  else { await sendMessage(api, `⚠️ اختر من 1 إلى 5`, threadID); return; }

  await saveProtectionSettings('global', newSettings);
  await deleteAdminSession(senderID);
  const si = (v) => v ? '🟢' : '🔴';
  await sendMessage(api,
    `╮───∙⋆⋅「 الحماية › تحديث 」\n│\n│ › الكنيات   ${si(newSettings.nicknames)}\n│ › الأسماء   ${si(newSettings.groupNames)}\n│ › الصور     ${si(newSettings.groupPhotos)}\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

// ═════════════════════════════════════════════════════════════════════
//   6. ريست
// ═════════════════════════════════════════════════════════════════════

async function handleReset(api, event) {
  await setBotConfig('restartNotifyThread', event.threadID);
  await sendMessage(api, `╮───∙⋆⋅「 ريست 」\n│\n│ › جارِ إعادة تشغيل البوت... ⟳\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID);
  setTimeout(() => process.exit(0), 2000);
}

// ═════════════════════════════════════════════════════════════════════
//   7. قاعدة البيانات
// ═════════════════════════════════════════════════════════════════════

const COLLECTION_LABELS = {
  players:'اللاعبون', temp_sessions:'جلسات التسجيل', notifications:'الإشعارات',
  counters:'عدادات الفئات', permanent_bans:'المحظورون', disabled_commands:'الأوامر المعطلة',
  command_watchers:'منتظرو الأوامر', bots:'البوتات', message_stats:'إحصائيات الرسائل',
  group_settings:'إعدادات القروبات', settings:'الإعدادات', admin_sessions:'جلسات الأدمن',
  market:'السوق', item_transfer_sessions:'جلسات التحويل', agent_conversations:'ذاكرة الوكلاء',
  bot_config:'إعدادات البوت', join_sessions:'جلسات الانضمام',
};
const DB_LIMIT = 512 * 1024 * 1024;
const _mb  = (b) => (b / (1024 * 1024)).toFixed(2);
const _bar = (p, n = 10) => { const f = Math.round((p / 100) * n); return '█'.repeat(f) + '░'.repeat(n - f); };

async function _buildQaeedaMsg() {
  let dbStats = null;
  try { dbStats = await getDB().command({ dbStats: 1, scale: 1 }); } catch (e) {}
  const usedBytes = dbStats ? ((dbStats.dataSize || 0) + (dbStats.indexSize || 0)) : 0;
  const percent   = Math.min(100, Math.round((usedBytes / DB_LIMIT) * 100));
  const icon      = percent >= 90 ? '🔴' : percent >= 70 ? '🟡' : '🟢';
  const colData   = [];
  for (const col of Object.keys(COLLECTION_LABELS)) {
    let count = 0, sz = 0;
    try { count = await getDB().collection(col).countDocuments(); const s = await getDB().command({ collStats: col, scale: 1 }); sz = (s.size || 0) + (s.totalIndexSize || 0); } catch (e) {}
    if (count === 0 && sz === 0) continue;
    colData.push({ col, label: COLLECTION_LABELS[col], count, colMB: _mb(sz) });
  }
  let colLines = '';
  colData.forEach((c, i) => { colLines += `│ ${i + 1}. ${c.label}\n│    ↳ ${c.count} سجل ┇ ${c.colMB} MB\n`; });
  const msg =
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n   ✦ قاعدة البيانات ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `╮───∙⋆⋅「 المساحة 」\n│ ${icon} ${_bar(percent)} ${percent}%\n│ › مستخدم  : ${_mb(usedBytes)} MB\n│ › متبقي   : ${_mb(Math.max(0, DB_LIMIT - usedBytes))} MB\n│ › الحد    : ${_mb(DB_LIMIT)} MB\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 المحتويات 」\n${colLines || '│ › قاعدة البيانات فارغة\n'}╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 الخيارات 」\n│ › ارسل رقم القسم لحذف محتوياته\n│ › 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
  return { msg, colData };
}

async function handleQaeedaDB(api, event) {
  const { msg, colData } = await _buildQaeedaMsg();
  await setAdminSession(event.senderID, { state: 'QAEEDA_MAIN', colData });
  await sendMessage(api, msg, event.threadID);
}

async function handleQaeedaDBSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();
  if (text === 'خروج') { await deleteAdminSession(senderID); await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  if (session.state === 'QAEEDA_CONFIRM') {
    if (text === 'تأكيد') {
      try { await getDB().collection(session.targetCol).deleteMany({}); await deleteAdminSession(senderID); await sendMessage(api, `╮───∙⋆⋅「 تم الحذف ✅️ 」\n│\n│ › تم مسح : ${session.targetLabel}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); }
      catch (e) { await deleteAdminSession(senderID); await sendMessage(api, `╮───∙⋆⋅「 خطأ ❌ 」\n│\n│ › فشل الحذف\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); }
    } else if (text === 'إلغاء' || text === 'الغاء') {
      const { msg: freshMsg, colData } = await _buildQaeedaMsg();
      await setAdminSession(senderID, { state: 'QAEEDA_MAIN', colData });
      await sendMessage(api, freshMsg, threadID);
    } else { await sendMessage(api, `⚠️ ارسل 《 تأكيد 》 للحذف أو 《 إلغاء 》 للرجوع`, threadID); }
    return;
  }
  const colData = session.colData || [], idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= colData.length) { await sendMessage(api, `⚠️ ارسل رقم من القائمة أو 《 خروج 》`, threadID); return; }
  const chosen = colData[idx];
  await setAdminSession(senderID, { state: 'QAEEDA_CONFIRM', targetCol: chosen.col, targetLabel: chosen.label });
  const warn = chosen.col === 'players' ? `│ ⚠️ تحذير: سيتم حذف جميع اللاعبين!\n` : '';
  await sendMessage(api, `╮───∙⋆⋅「 تأكيد الحذف 」\n│\n│ › القسم   : ${chosen.label}\n│ › السجلات : ${chosen.count}\n${warn}│\nارسل 《 تأكيد 》 للمتابعة\nارسل 《 إلغاء 》 للرجوع\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
}

// ═════════════════════════════════════════════════════════════════════
//   8. القروبات
// ═════════════════════════════════════════════════════════════════════

async function handleQarobaat(api, event) {
  const { threadID, senderID } = event;
  const g = config.groupes;
  const msg =
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n     ✦  قروبات الممالك  ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `╮───∙⋆⋅「 الايديهات الحالية 」\n│ › سولفارا : ${g.solfare || 'غير محدد'}\n│ › نيرافيل : ${g.niravil || 'غير محدد'}\n│ › مورداك  : ${g.murdak  || 'غير محدد'}\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 الخيارات 」\n│ 1 › تعديل ايدي سولفارا\n│ 2 › تعديل ايدي نيرافيل\n│ 3 › تعديل ايدي مورداك\n│ 4 › خروج\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
  await setAdminSession(senderID, { state: 'QAROBAAT_MAIN' });
  await sendMessage(api, msg, threadID);
}

async function handleQarobaatSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();
  if (text === 'خروج' || text === '4') { await deleteAdminSession(senderID); await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  if (session.state === 'QAROBAAT_MAIN') {
    const map = { '1':'solfare','2':'niravil','3':'murdak' }, arMap = { solfare:'سولفارا', niravil:'نيرافيل', murdak:'مورداك' };
    if (!map[text]) { await sendMessage(api, `⚠️ اختر من 1 إلى 4`, threadID); return; }
    const kingdom = map[text];
    await setAdminSession(senderID, { state: 'QAROBAAT_AWAIT_ID', kingdom });
    await sendMessage(api, `╮───∙⋆⋅「 تعديل ايدي ${arMap[kingdom]} 」\n│\n│ › الايدي الحالي : ${config.groupes[kingdom] || 'غير محدد'}\n│\n│ › ارسل الايدي الجديد\n│ › او اكتب 《 خروج 》\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
  }
  if (session.state === 'QAROBAAT_AWAIT_ID') {
    const arMap = { solfare:'سولفارا', niravil:'نيرافيل', murdak:'مورداك' }, kingdom = session.kingdom;
    if (!/^\d{5,}$/.test(text)) { await sendMessage(api, `⚠️ الايدي غير صحيح\nأعد المحاولة او اكتب 《 خروج 》`, threadID); return; }
    const oldId = config.groupes[kingdom]; config.groupes[kingdom] = text; await setBotConfig('groupes', config.groupes);
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم التعديل ✅️ 」\n│\n│ › المملكة  : ${arMap[kingdom]}\n│ › الايدي القديم : ${oldId || 'غير محدد'}\n│ › الايدي الجديد : ${text}\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
  }
}

// ═════════════════════════════════════════════════════════════════════
//   9. الذكاء الاصطناعي والوكلاء
// ═════════════════════════════════════════════════════════════════════

async function handleNexusAI(api, event) {
  const { threadID, senderID } = event;
  const agents = await getAllAgents();
  const lines  = agents.length ? agents.map((a, i) => `│ ${i + 1}. ◈ ${a.name}`).join('\n') : `│ › لا يوجد وكلاء مضافون بعد`;
  await setAdminSession(senderID, { state: 'NEXUS_AI_MAIN', agents: agents.map(a => a.name) });
  await sendMessage(api,
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n     ✦  نيكسوس — الذكاء الاصطناعي  ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `╮───∙⋆⋅「 الوكلاء الحاليون 」\n${lines}\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 الخيارات 」\n│ 1 › اضافة وكيل جديد\n│ 2 › تعديل برومت وكيل\n│ 3 › حذف وكيل\n│ 4 › خروج\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

const _cfgRead = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname,'config.json'),'utf8')); } catch(_){ return {}; } };
const _cfgWrite = (c) => { try { fs.writeFileSync(path.join(__dirname,'config.json'),JSON.stringify(c,null,2),'utf8'); } catch(e){} };
function getMemoryLimit()         { return parseInt(_cfgRead().memoryLimit) || 10; }
function getConversationTimeout() { return parseInt(_cfgRead().conversationTimeout) || 20; }
function saveMemoryLimit(n)       { const c = _cfgRead(); c.memoryLimit = n; _cfgWrite(c); }
function saveConvTimeout(m)       { const c = _cfgRead(); c.conversationTimeout = m; _cfgWrite(c); }

async function handleZakira(api, event, sub) {
  const { threadID } = event;
  if (!sub) {
    const agents  = await getAllAgents();
    const lines   = agents.length ? (await Promise.all(agents.map(async a => { const cnt = await countAgentConversations(a.name); return `│  ◈ ${a.name}  ←  ${cnt} محادثة`; }))).join('\n') + '\n' : `│  لا يوجد وكلاء\n`;
    const total   = await countAgentConversations(null);
    await sendMessage(api,
      `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n      🧠  إدارة ذاكرة الوكلاء\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
      `╮───∙⋆⋅「 الإعداد الحالي 」\n│  حد الذاكرة : ${getMemoryLimit()} تبادل\n│  انتهاء المحادثة : بعد ${getConversationTimeout()} دقيقة\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
      `╮───∙⋆⋅「 المحادثات المخزنة 」\n${lines}│  الإجمالي: ${total} محادثة\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
      `╮───∙⋆⋅「 الأوامر 」\n│  ذاكرة تحديد [رقم]\n│  ذاكرة وقت [دقائق]\n│  ذاكرة مسح\n│  ذاكرة مسح [اسم الوكيل]\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID); return;
  }
  const setM = sub.match(/^تحديد\s+(\d+)$/);
  if (setM) { const n = parseInt(setM[1]); if (n < 1 || n > 100) { await sendMessage(api, `╮───∙⋆⋅「 ذاكرة 」\n│\n│ › الرقم بين 1 و 100\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; } saveMemoryLimit(n); await sendMessage(api, `╮───∙⋆⋅「 ذاكرة 」\n│\n│ › ✅ تم تحديث الحد إلى ${n} تبادل\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  if (sub === 'مسح') { const cnt = await clearAllAgentConversations(); await sendMessage(api, `╮───∙⋆⋅「 ذاكرة 」\n│\n│ › ✅ تم مسح ${cnt} محادثة\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  const clrM = sub.match(/^مسح\s+(.+)$/);
  if (clrM) { const nm = clrM[1].trim(); if (!(await getAgentByName(nm))) { await sendMessage(api, `╮───∙⋆⋅「 ذاكرة 」\n│\n│ › لا يوجد وكيل باسم "${nm}"\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; } const cnt = await clearAgentConversationsByName(nm); await sendMessage(api, `╮───∙⋆⋅「 ذاكرة 」\n│\n│ › ✅ تم مسح ذاكرة ${nm} (${cnt})\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  const tmM = sub.match(/^وقت\s+(\d+)$/);
  if (tmM) { const m = parseInt(tmM[1]); if (m < 1 || m > 1440) { await sendMessage(api, `╮───∙⋆⋅「 ذاكرة 」\n│\n│ › الوقت بين 1 و 1440 دقيقة\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; } saveConvTimeout(m); const h = m >= 60 ? ` (${(m/60).toFixed(1)} ساعة)` : ''; await sendMessage(api, `╮───∙⋆⋅「 ذاكرة 」\n│\n│ › ✅ وقت الانتهاء : ${m} دقيقة${h}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  await sendMessage(api, `╮───∙⋆⋅「 ذاكرة 」\n│\n│ › أمر غير معروف\n│ › أرسل 《 ذاكرة 》 لعرض الأوامر\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
}

async function handleNexusAISession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();
  if (text === 'خروج' || text === '4') { await deleteAdminSession(senderID); await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  if (session.state === 'NEXUS_AI_MAIN') {
    if (text === '1') { await setAdminSession(senderID,{state:'NEXUS_ADD_NAME'}); await sendMessage(api,`╮───∙⋆⋅「 اضافة وكيل 」\n│\n│ › اكتب اسم الوكيل\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,threadID); return; }
    if (text === '2') { const a = await getAllAgents(); if (!a.length){await sendMessage(api,`⚠️ لا يوجد وكلاء`,threadID);await deleteAdminSession(senderID);return;} let m=`╮───∙⋆⋅「 تعديل البرومت 」\n│\n`;a.forEach((x,i)=>{m+=`│ ${i+1}. ${x.name}\n`;}); m+=`│\n│ › اكتب رقم الوكيل\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`; await setAdminSession(senderID,{state:'NEXUS_EDIT_SELECT',agents:a.map(x=>x.name)}); await sendMessage(api,m,threadID); return; }
    if (text === '3') { const a = await getAllAgents(); if (!a.length){await sendMessage(api,`⚠️ لا يوجد وكلاء`,threadID);await deleteAdminSession(senderID);return;} let m=`╮───∙⋆⋅「 حذف وكيل 」\n│\n`;a.forEach((x,i)=>{m+=`│ ${i+1}. ${x.name}\n`;}); m+=`│\n│ › اكتب رقم الوكيل\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`; await setAdminSession(senderID,{state:'NEXUS_DELETE_SELECT',agents:a.map(x=>x.name)}); await sendMessage(api,m,threadID); return; }
    await sendMessage(api, `⚠️ اختر من 1 إلى 4`, threadID); return;
  }
  if (session.state === 'NEXUS_ADD_NAME') { if (!text||text.length<2){await sendMessage(api,`⚠️ اسم قصير جداً`,threadID);return;} if (await getAgentByName(text)){await sendMessage(api,`⚠️ يوجد وكيل بهذا الاسم`,threadID);return;} await setAdminSession(senderID,{state:'NEXUS_ADD_KEY',agentName:text}); await sendMessage(api,`╮───∙⋆⋅「 مفتاح Groq 」\n│\n│ › الوكيل : ${text}\n│\n│ › أرسل مفتاح API من Groq\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,threadID); return; }
  if (session.state === 'NEXUS_ADD_KEY') { if (!text.startsWith('gsk_')||text.length<20){await sendMessage(api,`⚠️ المفتاح يجب أن يبدأ بـ gsk_\nأعد المحاولة أو 《 خروج 》`,threadID);return;} await setAdminSession(senderID,{state:'NEXUS_ADD_PROMPT',agentName:session.agentName,apiKey:text}); await sendMessage(api,`╮───∙⋆⋅「 الشخصية والبرومت 」\n│\n│ › الوكيل : ${session.agentName}\n│\n│ › الآن اكتب البرومت\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,threadID); return; }
  if (session.state === 'NEXUS_ADD_PROMPT') { if (!text||text.length<10){await sendMessage(api,`⚠️ البرومت قصير جداً`,threadID);return;} await addAgent(session.agentName,session.apiKey,text); await deleteAdminSession(senderID); await sendMessage(api,`╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n     ✦ تم إضافة الوكيل ✅️ ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n╮───∙⋆⋅「 التفاصيل 」\n│ › الاسم  : ${session.agentName}\n│ › الحالة : نشط 🟢\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\nاكتب 《 ايجنت 》 لرؤيته`,threadID); return; }
  if (session.state === 'NEXUS_EDIT_SELECT') { const idx=parseInt(text,10)-1; if(isNaN(idx)||idx<0||idx>=(session.agents||[]).length){await sendMessage(api,`⚠️ رقم غير صحيح`,threadID);return;} await setAdminSession(senderID,{state:'NEXUS_EDIT_PROMPT',agentName:session.agents[idx]}); await sendMessage(api,`╮───∙⋆⋅「 تعديل برومت 」\n│\n│ › الوكيل : ${session.agents[idx]}\n│\n│ › اكتب البرومت الجديد\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,threadID); return; }
  if (session.state === 'NEXUS_EDIT_PROMPT') { if (!text||text.length<10){await sendMessage(api,`⚠️ البرومت قصير جداً`,threadID);return;} await updateAgent(session.agentName,{prompt:text}); await deleteAdminSession(senderID); await sendMessage(api,`╮───∙⋆⋅「 تم التعديل ✅️ 」\n│\n│ › الوكيل : ${session.agentName}\n│ › البرومت : تم تحديثه\n╯───────∙⋆⋅ ※ ⋅⋆∙`,threadID); return; }
  if (session.state === 'NEXUS_DELETE_SELECT') { const idx=parseInt(text,10)-1; if(isNaN(idx)||idx<0||idx>=(session.agents||[]).length){await sendMessage(api,`⚠️ رقم غير صحيح`,threadID);return;} const name=session.agents[idx]; await deleteAgent(name); await deleteAdminSession(senderID); await sendMessage(api,`╮───∙⋆⋅「 تم الحذف 🗑️ 」\n│\n│ › الوكيل : ${name}\n│ › تم حذفه بنجاح\n╯───────∙⋆⋅ ※ ⋅⋆∙`,threadID); return; }
}

// ═════════════════════════════════════════════════════════════════════
//   الصادرات
// ═════════════════════════════════════════════════════════════════════

module.exports = {
  initBotEnabled, isBotEnabled, handleBotStop, handleBotStart,
  handleBotaat, handleBotaatSession,
  handleTabdeel, handleTabdeelSession,
  handleEadatDabt,
  handleHimaya, handleHimayaSession, handleProtection,
  snapshotNicknames, snapshotGroupNames, snapshotGroupPhotos,
  handleReset,
  handleQaeedaDB, handleQaeedaDBSession,
  handleQarobaat, handleQarobaatSession,
  handleNexusAI, handleZakira, handleNexusAISession,
  handleManshourat, handleManshouraatSession,
};
