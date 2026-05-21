/*
 * ═══════════════════════════════════════════════════════════════════════
 *  nashr.js — نظام كوينز النشر
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  للاعبين:
 *    - أمر "كوينز النشر"  : يعرض التعليمات ويفتح جلسة انتظار الرابط
 *    - الرد برابط المنشور : يتحقق عبر Apify ويمنح الكوينز ويحدث نقاط المسابقة
 *
 *  للأدمن:
 *    - أمر "منشورات"      : لوحة إدارة كاملة
 *      ├── إحصائيات المنشورات (مقبول / مرفوض / الكل)
 *      ├── إدارة توكنات Apify (إضافة / عرض الرصيد / حذف)
 *      └── نظام التوكنات المتعدد مع التبديل التلقائي
 * ═══════════════════════════════════════════════════════════════════════
 */

'use strict';

const config = require('./config.json');
const { sendMessage, sendReply } = require('./utils');
const {
  getPlayer, updatePlayer,
  getAdminSession, setAdminSession, deleteAdminSession,
  getNashrSession, setNashrSession, deleteNashrSession,
  getNashrPost,    addNashrPost,
  getApifyTokens,  addApifyToken, removeApifyToken,
  incrementTokenUse,
  getNashrSettings, updateNashrSettings,
} = require('./database');

// ─────────────────────────────────────────────────────────────────────
//  ثوابت
// ─────────────────────────────────────────────────────────────────────
// القيم الافتراضية (تُستبدل بالقيم المحفوظة في DB)
const DEFAULT_MIN_REACTIONS   = 10;
const DEFAULT_COINS_PER_REACT = 3;
const APIFY_ACTOR             = 'apify~facebook-posts-scraper';
const APIFY_TIMEOUT           = 60;

// مساعد: جلب الإعدادات من DB مع الاحتياطي
async function getSettings() {
  try { return await getNashrSettings(); }
  catch { return { minReactions: DEFAULT_MIN_REACTIONS, coinsPerReact: DEFAULT_COINS_PER_REACT }; }
}

// مساعد: تفاعل البوت على رسالة
function reactTo(api, messageID, threadID, emoji) {
  return new Promise(r => api.setMessageReaction(emoji, messageID, threadID, () => r(), true));
}

// ═════════════════════════════════════════════════════════════════════
//  الجزء الأول — Apify
// ═════════════════════════════════════════════════════════════════════

/**
 * يستدعي Apify ويُرجع بيانات المنشور.
 * يجرب التوكنات بالترتيب، وإذا فشل توكن بسبب الرصيد يجرب التالي.
 */
async function fetchPostFromApify(postUrl) {
  const tokens = await getApifyTokens();
  const active  = tokens.filter(t => !t.disabled);

  if (!active.length) throw new Error('NO_TOKENS');

  for (const tokenDoc of active) {
    const endpoint =
      `https://api.apify.com/v2/acts/${APIFY_ACTOR}` +
      `/run-sync-get-dataset-items` +
      `?token=${tokenDoc.token}&timeout=${APIFY_TIMEOUT}&memory=256`;

    try {
      const res = await fetch(endpoint, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          startUrls: [{ url: postUrl }],
          maxPosts : 1,
        }),
      });

      // رصيد نفذ أو توكن غير صالح → جرّب التالي
      if (res.status === 401 || res.status === 402 || res.status === 403) {
        console.warn(`[nashr] توكن ${tokenDoc.username} أُعطل (HTTP ${res.status})`);
        continue;
      }

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Apify HTTP ${res.status}: ${txt.slice(0, 120)}`);
      }

      await incrementTokenUse(tokenDoc._id);

      const items = await res.json();
      if (Array.isArray(items) && items.length > 0) {
        console.log('[nashr] raw Apify fields:', JSON.stringify(Object.keys(items[0])));
        return items[0];
      }
      return null;

    } catch (err) {
      if (err.message.startsWith('Apify HTTP')) throw err;
      throw err;
    }
  }

  throw new Error('ALL_TOKENS_FAILED');
}

/**
 * يجلب معلومات حساب Apify (الخطة + الاستهلاك الشهري).
 * GET /v2/users/me  +  GET /v2/users/me/limits
 */
async function fetchApifyAccountInfo(token) {
  const [meRes, limitsRes] = await Promise.all([
    fetch(`https://api.apify.com/v2/users/me?token=${token}`),
    fetch(`https://api.apify.com/v2/users/me/limits?token=${token}`),
  ]);

  const me     = meRes.ok     ? (await meRes.json()).data     : null;
  const limits = limitsRes.ok ? (await limitsRes.json()).data : null;

  return { me, limits };
}

// ─────────────────────────────────────────────────────────────────────
//  مساعدات استخراج بيانات المنشور
// ─────────────────────────────────────────────────────────────────────

function extractNumericId(url) {
  if (!url) return null;
  const m1 = url.match(/profile\.php\?id=(\d+)/);
  if (m1) return m1[1];
  const m2 = url.match(/facebook\.com\/(?:[^/?#]+\/)*(\d{10,})(?:[/?#]|$)/);
  return m2 ? m2[1] : null;
}

function extractGroupId(url) {
  if (!url) return null;
  const m = url.match(/facebook\.com\/groups\/(\d+)/i);
  return m ? m[1] : null;
}

/**
 * يُحوّل استجابة Apify إلى حقول مُوحَّدة.
 * يدعم حقول كلا الـ actor:
 *   apify~facebook-posts-scraper : postUrl, author.id/url, reactionsCount/likesCount
 *   curious_coder~facebook-post-scraper : url, user.id/url, reactions.total, group.id/url
 */
function parseApifyPost(data) {
  const canonicalUrl = data.url || data.postUrl || data.link || null;

  // معرف الناشر — يدعم user أو author
  const userObj  = data.user || data.author || {};
  const authorId = String(
    userObj.id ||
    extractNumericId(userObj.url || userObj.profileUrl || userObj.link || '') || ''
  );

  // معرف المجموعة — يدعم group أو مضمّن في الرابط
  const groupObj = data.group || {};
  const groupId  = String(
    groupObj.id ||
    data.groupId ||
    extractGroupId(groupObj.url || groupObj.link || '') ||
    extractGroupId(canonicalUrl || '') || ''
  );

  // التفاعلات — يدعم تنسيقات متعددة
  const reactObj  = data.reactions || {};
  const reactions = Number(
    reactObj.total ?? reactObj.count ??
    data.reactionsCount ?? data.likesCount ??
    data.likes ?? data.reactionCount ?? 0
  );

  return { canonicalUrl, authorId, groupId, reactions };
}

// ═════════════════════════════════════════════════════════════════════
//  الجزء الثاني — ميزة اللاعبين
// ═════════════════════════════════════════════════════════════════════

async function handleKoinezNashr(api, event) {
  const { threadID, senderID, messageID } = event;

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api,
      `╮───∙⋆⋅「 خطأ 」\n│ › أنت غير مسجل في اللعبة ❌\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
    return;
  }

  const tokens = await getApifyTokens();
  if (!tokens.filter(t => !t.disabled).length) {
    await sendReply(api,
      `╮───∙⋆⋅「 غير متاح ⚠️ 」\n│ › هذه الميزة غير متاحة حالياً\n│ › تواصل مع الأدمن\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
    return;
  }

  const { minReactions, coinsPerReact } = await getSettings();

  const info = await sendReply(api,
    `؜╮───∙⋆⋅「 كوينز النشر 」\n` +
    `│ › ◍ طريقة الحصول على الكوينز من خلال النشر في مجموعة النضام\n` +
    `│ › ➊ قم بنشر منشور في مجموعة النضام ​❆ للحصول الى رابطها اكتب《 قروب 》\n` +
    `│ › ➋ انتظر حتى تحصل على تفاعل جيد في منشورك لان كل تفاعل على منشورك = ${coinsPerReact} كوينز \n` +
    `│ › ➌ بعدها قم بنسخ رابط منشورك ورد على هذه الرسالة برابط المنشور \n` +
    `│ › ⚠️  | يجب على منشورك ان يكون فيه ${minReactions} تفاعلات على الاقل \n` +
    `│ › ⚠️  يتم قبول كل منشور مرة واحدة ولا تحصل على كوينز منه مجددا\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙`,
    messageID, threadID);

  await setNashrSession(senderID, {
    step        : 'AWAITING_URL',
    botMessageId: info?.messageID || null,
    threadID,
  });
}

async function handleNashrReply(api, event, session) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();

  await deleteNashrSession(senderID);

  // فحص: هل يحتوي على رابط فيسبوك؟
  if (!text.includes('facebook.com') && !text.includes('fb.com') && !text.includes('fb.watch')) {
    await sendReply(api,
      `╮───∙⋆⋅「 خطأ 」\n│ › الرابط غير صالح ❌\n│ › يجب أن يكون رابط منشور فيسبوك\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
    return true;
  }

  // تفاعل ⏳ فوري على رسالة الرابط
  reactTo(api, messageID, threadID, '⏳').catch(() => {});

  // رسالة "جاري الفحص" أثناء انتظار Apify
  await sendReply(api,
    `╮───∙⋆⋅「 جاري الفحص ⏳ 」\n│ › يتم التحقق من منشورك، انتظر لحظة...\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    messageID, threadID);

  const { minReactions, coinsPerReact } = await getSettings();

  // استدعاء Apify
  let postData;
  try {
    postData = await fetchPostFromApify(text);
  } catch (err) {
    console.error('[nashr] Apify error:', err.message);
    reactTo(api, messageID, threadID, '❌').catch(() => {});
    const msg = (err.message === 'NO_TOKENS' || err.message === 'ALL_TOKENS_FAILED')
      ? `╮───∙⋆⋅「 خطأ 」\n│ › ❌ الخدمة غير متاحة حالياً\n│ › حاول مرة أخرى لاحقاً\n╯───────∙⋆⋅ ※ ⋅⋆∙`
      : `╮───∙⋆⋅「 خطأ 」\n│ › ❌ فشل في جلب بيانات المنشور\n│ › تأكد أن المنشور عام وحاول مجدداً\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
    await sendReply(api, msg, messageID, threadID);
    return true;
  }

  if (!postData) {
    reactTo(api, messageID, threadID, '❌').catch(() => {});
    await sendReply(api,
      `╮───∙⋆⋅「 خطأ 」\n│ › ❌ لم يتم العثور على المنشور\n│ › تأكد أن الرابط صحيح وأن المنشور عام\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
    return true;
  }

  const { canonicalUrl, authorId, groupId, reactions } = parseApifyPost(postData);
  const checkUrl      = canonicalUrl || text;
  const systemGroupId = String(config.systemGroup || '');

  // ── 1) فحص المجموعة ──
  if (!groupId || groupId !== systemGroupId) {
    reactTo(api, messageID, threadID, '❌').catch(() => {});
    await sendReply(api,
      `╮───∙⋆⋅「 مرفوض ❌ 」\n│ › المنشور ليس من مجموعة النضام الرسمية\n│ › اكتب《 قروب 》للحصول على رابط المجموعة\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
    await _logAttempt(senderID, text, canonicalUrl, 'WRONG_GROUP', reactions);
    return true;
  }

  // ── 2) فحص هوية الناشر ──
  if (!authorId || authorId !== String(senderID)) {
    reactTo(api, messageID, threadID, '❌').catch(() => {});
    await sendReply(api,
      `╮───∙⋆⋅「 مرفوض ❌ 」\n│ › المنشور ليس من حسابك\n│ › يجب أن تكون أنت ناشر المنشور\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
    await _logAttempt(senderID, text, canonicalUrl, 'WRONG_AUTHOR', reactions);
    return true;
  }

  // ── 3) فحص عدد التفاعلات ──
  if (reactions < minReactions) {
    reactTo(api, messageID, threadID, '❌').catch(() => {});
    await sendReply(api,
      `╮───∙⋆⋅「 مرفوض ❌ 」\n│ › منشورك لديه ${reactions} تفاعل فقط\n│ › ⚠️ يجب أن يكون لديك ${minReactions} تفاعلات على الأقل\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
    await _logAttempt(senderID, text, canonicalUrl, 'LOW_REACTIONS', reactions);
    return true;
  }

  // ── 4) فحص تكرار المنشور ──
  const existing = await getNashrPost(checkUrl);
  if (existing) {
    reactTo(api, messageID, threadID, '❌').catch(() => {});
    await sendReply(api,
      `╮───∙⋆⋅「 مرفوض ❌ 」\n│ › هذا المنشور سبق قبوله ولا يمكن استخدامه مجدداً\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
    await _logAttempt(senderID, text, canonicalUrl, 'DUPLICATE', reactions);
    return true;
  }

  // ── تجاوز جميع الفحوصات ← منح الكوينز ──
  const earned   = reactions * coinsPerReact;
  const player   = await getPlayer(senderID);
  const newCoins = (player?.coins || 0) + earned;

  await updatePlayer(senderID, { coins: newCoins });
  await addNashrPost(checkUrl, senderID, reactions, earned);

  // ── تسجيل كوينز النشر في نقاط المسابقة الحالية ──
  try {
    const { recordNashrCoins } = require('./Mosaba9at');
    await recordNashrCoins(senderID, earned, player?.nickname || String(senderID));
  } catch (compErr) {
    console.error('[Competition] خطأ في تسجيل كوينز النشر بالمسابقة:', compErr);
  }

  reactTo(api, messageID, threadID, '✅').catch(() => {});
  await sendReply(api,
    `╮───∙⋆⋅「 تم القبول ✅ 」\n` +
    `│ › 🎉 تم قبول منشورك بنجاح!\n` +
    `│ › ◍ عدد التفاعلات    : ${reactions}\n` +
    `│ › 💰 الكوينز المكتسبة : ${earned} كوينز\n` +
    `│ › 💎 كوينزك الحالي   : ${newCoins} كوينز\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙`,
    messageID, threadID);

  return true;
}

async function _logAttempt(fbId, rawUrl, canonicalUrl, reason, reactions) {
  try {
    const { getDB } = require('./database');
    await getDB().collection('nashr_attempts').insertOne({
      fbId: String(fbId), rawUrl, canonicalUrl,
      reason, reactions: reactions || 0, createdAt: new Date(),
    });
  } catch (_) {}
}

// ═════════════════════════════════════════════════════════════════════
//  الجزء الثالث — لوحة الأدمن
// ═════════════════════════════════════════════════════════════════════

async function handleManshourat(api, event) {
  const { threadID, senderID } = event;

  const { getDB } = require('./database');
  const [accepted, rejected, tokens] = await Promise.all([
    getDB().collection('nashr_posts').countDocuments(),
    getDB().collection('nashr_attempts').countDocuments(),
    getApifyTokens(),
  ]);

  const activeT = tokens.filter(t => !t.disabled).length;

  const { minReactions, coinsPerReact } = await getSettings();

  await setAdminSession(senderID, { state: 'NASHR_MAIN' });
  await sendMessage(api,
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n` +
    `     ✦  إدارة المنشورات  ✦\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `╮───∙⋆⋅「 الإحصائيات 」\n` +
    `│ › ✅ مقبولة  : ${accepted}\n` +
    `│ › ❌ مرفوضة : ${rejected}\n` +
    `│ › 📊 الكل    : ${accepted + rejected}\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 Apify 」\n` +
    `│ › التوكنات : ${tokens.length} (نشط: ${activeT})\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 الإعدادات الحالية 」\n` +
    `│ › الحد الأدنى للتفاعلات : ${minReactions}\n` +
    `│ › الكوينز لكل تفاعل     : ${coinsPerReact}\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 الخيارات 」\n` +
    `│ 1 › إدارة التوكنات\n` +
    `│ 2 › إحصائيات مفصّلة\n` +
    `│ 3 › إعدادات النشر\n` +
    `│ 4 › خروج\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

async function handleManshouraatSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();

  if (text === 'خروج' || text === '4') {
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }

  // ── القائمة الرئيسية ──
  if (session.state === 'NASHR_MAIN') {
    if (text === '1') { await _showTokensMenu(api, event);    return; }
    if (text === '2') { await _showDetailedStats(api, event); return; }
    if (text === '3') { await _showSettingsMenu(api, event);  return; }
    await sendMessage(api, `⚠️ اختر 1 أو 2 أو 3 أو 4`, threadID);
    return;
  }

  // ── قائمة الإعدادات ──
  if (session.state === 'NASHR_SETTINGS_MAIN') {
    if (text === '1') {
      await setAdminSession(senderID, { state: 'NASHR_SETTINGS_MIN' });
      const { minReactions } = await getSettings();
      await sendMessage(api,
        `╮───∙⋆⋅「 الحد الأدنى للتفاعلات 」\n` +
        `│ › الحالي : ${minReactions}\n│\n` +
        `│ › أرسل الرقم الجديد\n│ › او 《 خروج 》\n` +
        `╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      return;
    }
    if (text === '2') {
      await setAdminSession(senderID, { state: 'NASHR_SETTINGS_COINS' });
      const { coinsPerReact } = await getSettings();
      await sendMessage(api,
        `╮───∙⋆⋅「 الكوينز لكل تفاعل 」\n` +
        `│ › الحالي : ${coinsPerReact}\n│\n` +
        `│ › أرسل الرقم الجديد\n│ › او 《 خروج 》\n` +
        `╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      return;
    }
    await sendMessage(api, `⚠️ اختر 1 أو 2 أو 《 خروج 》`, threadID);
    return;
  }

  // ── تغيير الحد الأدنى للتفاعلات ──
  if (session.state === 'NASHR_SETTINGS_MIN') {
    const num = parseInt(text, 10);
    if (isNaN(num) || num < 1) {
      await sendMessage(api, `⚠️ أدخل رقماً صحيحاً أكبر من 0`, threadID);
      return;
    }
    await updateNashrSettings({ minReactions: num });
    await deleteAdminSession(senderID);
    await sendMessage(api,
      `╮───∙⋆⋅「 تم التحديث ✅ 」\n│ › الحد الأدنى للتفاعلات أصبح : ${num}\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }

  // ── تغيير الكوينز لكل تفاعل ──
  if (session.state === 'NASHR_SETTINGS_COINS') {
    const num = parseInt(text, 10);
    if (isNaN(num) || num < 1) {
      await sendMessage(api, `⚠️ أدخل رقماً صحيحاً أكبر من 0`, threadID);
      return;
    }
    await updateNashrSettings({ coinsPerReact: num });
    await deleteAdminSession(senderID);
    await sendMessage(api,
      `╮───∙⋆⋅「 تم التحديث ✅ 」\n│ › الكوينز لكل تفاعل أصبح : ${num}\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }

  // ── قائمة التوكنات ──
  if (session.state === 'NASHR_TOKENS_MAIN') {
    if (text === '1') {
      await setAdminSession(senderID, { state: 'NASHR_TOKEN_ADD' });
      await sendMessage(api,
        `╮───∙⋆⋅「 إضافة توكن 」\n│ › أرسل توكن Apify\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        threadID);
      return;
    }
    if (text === '2') { await _showTokensStatus(api, event);     return; }
    if (text === '3') { await _showTokenDeleteMenu(api, event);  return; }
    await sendMessage(api, `⚠️ اختر 1 أو 2 أو 3`, threadID);
    return;
  }

  // ── إضافة توكن ──
  if (session.state === 'NASHR_TOKEN_ADD') {
    if (!text || text.length < 10) {
      await sendMessage(api, `⚠️ التوكن قصير جداً، أعد المحاولة`, threadID);
      return;
    }

    await sendMessage(api,
      `╮───∙⋆⋅「 جاري التحقق ⏳ 」\n│ › يتم التحقق من التوكن...\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);

    const { me, limits } = await fetchApifyAccountInfo(text);
    if (!me) {
      await sendMessage(api,
        `╮───∙⋆⋅「 خطأ ❌ 」\n│ › التوكن غير صالح\n│ › أعد المحاولة أو اكتب 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        threadID);
      return;
    }

    await addApifyToken(text, me.username || 'غير معروف');
    await deleteAdminSession(senderID);

    const plan    = me.plan       || {};
    const cur     = limits?.current || {};
    const lim     = limits?.limits  || {};
    const usedUsd = (cur.monthlyUsageUsd || 0).toFixed(3);
    const maxUsd  = (lim.maxMonthlyUsageUsd || plan.maxMonthlyUsageUsd || 0).toFixed(2);
    const credits = (plan.monthlyUsageCreditsUsd || 0).toFixed(2);
    const remain  = Math.max(0, parseFloat(credits) - parseFloat(usedUsd)).toFixed(3);

    await sendMessage(api,
      `╮───∙⋆⋅「 تمت الإضافة ✅ 」\n` +
      `│ › المستخدم    : ${me.username}\n` +
      `│ › الخطة       : ${plan.id || 'غير معروف'}\n` +
      `│ › الرصيد      : $${credits} / شهر\n` +
      `│ › المستهلك    : $${usedUsd}\n` +
      `│ › المتبقي     : $${remain}\n` +
      `│ › الحد الأقصى : $${maxUsd}\n` +
      `╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }

  // ── حذف توكن ──
  if (session.state === 'NASHR_TOKEN_DELETE') {
    const tokens = session.tokens || [];
    const idx    = parseInt(text, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= tokens.length) {
      await sendMessage(api, `⚠️ رقم غير صحيح`, threadID);
      return;
    }
    const chosen = tokens[idx];
    await removeApifyToken(chosen._id);
    await deleteAdminSession(senderID);
    await sendMessage(api,
      `╮───∙⋆⋅「 تم الحذف 🗑️ 」\n│ › تم حذف توكن : ${chosen.username}\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }
}

// ─── دوال مساعدة للأدمن ─────────────────────────────────────────────

async function _showTokensMenu(api, event) {
  const { threadID, senderID } = event;
  const tokens = await getApifyTokens();
  const active  = tokens.filter(t => !t.disabled).length;

  await setAdminSession(senderID, { state: 'NASHR_TOKENS_MAIN' });
  await sendMessage(api,
    `╮───∙⋆⋅「 توكنات Apify 」\n` +
    `│ › الكل   : ${tokens.length}\n` +
    `│ › نشط    : ${active}\n` +
    `│ › معطّل  : ${tokens.length - active}\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 الخيارات 」\n` +
    `│ 1 › إضافة توكن جديد\n` +
    `│ 2 › عرض حالة التوكنات والرصيد\n` +
    `│ 3 › حذف توكن\n` +
    `│ › 《 خروج 》\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

async function _showTokensStatus(api, event) {
  const { threadID, senderID } = event;
  const tokens = await getApifyTokens();

  if (!tokens.length) {
    await sendMessage(api,
      `╮───∙⋆⋅「 التوكنات 」\n│ › لا يوجد توكنات مضافة بعد\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }

  await sendMessage(api,
    `╮───∙⋆⋅「 جاري جلب البيانات ⏳ 」\n│ › يتم جلب معلومات كل توكن...\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);

  let msg = `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n     ✦  حالة التوكنات  ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n`;

  for (let i = 0; i < tokens.length; i++) {
    const t      = tokens[i];
    const status = t.disabled ? '🔴 معطّل' : '🟢 نشط';
    try {
      const { me, limits } = await fetchApifyAccountInfo(t.token);
      if (me && limits) {
        const plan    = me.plan       || {};
        const cur     = limits.current  || {};
        const lim     = limits.limits   || {};
        const usedUsd = (cur.monthlyUsageUsd    || 0).toFixed(3);
        const maxUsd  = (lim.maxMonthlyUsageUsd || plan.maxMonthlyUsageUsd || 0).toFixed(2);
        const credits = (plan.monthlyUsageCreditsUsd || 0).toFixed(2);
        const remain  = Math.max(0, parseFloat(credits) - parseFloat(usedUsd)).toFixed(3);

        msg +=
          `╮───∙⋆⋅「 ${i + 1}. ${t.username} 」\n` +
          `│ › الحالة    : ${status}\n` +
          `│ › الخطة     : ${plan.id || '—'}\n` +
          `│ › الرصيد    : $${credits} / شهر\n` +
          `│ › المستهلك  : $${usedUsd}\n` +
          `│ › المتبقي   : $${remain}\n` +
          `│ › الحد      : $${maxUsd}\n` +
          `│ › فحوصات   : ${t.useCount || 0} مرة\n` +
          `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n`;
      } else {
        msg +=
          `╮───∙⋆⋅「 ${i + 1}. ${t.username} 」\n` +
          `│ › الحالة   : ${status}\n` +
          `│ › ⚠️ فشل في جلب البيانات\n` +
          `│ › فحوصات  : ${t.useCount || 0} مرة\n` +
          `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n`;
      }
    } catch (_) {
      msg +=
        `╮───∙⋆⋅「 ${i + 1}. ${t.username} 」\n` +
        `│ › الحالة   : ${status}\n` +
        `│ › ❌ خطأ في الاتصال\n` +
        `│ › فحوصات  : ${t.useCount || 0} مرة\n` +
        `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n`;
    }
  }

  await setAdminSession(senderID, { state: 'NASHR_MAIN' });
  await sendMessage(api, msg.trimEnd(), threadID);
}

async function _showDetailedStats(api, event) {
  const { threadID, senderID } = event;
  const { getDB } = require('./database');

  const [accepted, wrongGroup, wrongAuthor, lowReactions, duplicate] = await Promise.all([
    getDB().collection('nashr_posts').countDocuments(),
    getDB().collection('nashr_attempts').countDocuments({ reason: 'WRONG_GROUP'   }),
    getDB().collection('nashr_attempts').countDocuments({ reason: 'WRONG_AUTHOR'  }),
    getDB().collection('nashr_attempts').countDocuments({ reason: 'LOW_REACTIONS' }),
    getDB().collection('nashr_attempts').countDocuments({ reason: 'DUPLICATE'     }),
  ]);
  const rejected = wrongGroup + wrongAuthor + lowReactions + duplicate;

  await setAdminSession(senderID, { state: 'NASHR_MAIN' });
  await sendMessage(api,
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n` +
    `   ✦  إحصائيات المنشورات  ✦\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `╮───∙⋆⋅「 الإجمالي 」\n` +
    `│ › ✅ مقبولة         : ${accepted}\n` +
    `│ › ❌ مرفوضة (كل)    : ${rejected}\n` +
    `│ › 📊 الكل           : ${accepted + rejected}\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 أسباب الرفض 」\n` +
    `│ › قروب خاطئ        : ${wrongGroup}\n` +
    `│ › ناشر مختلف       : ${wrongAuthor}\n` +
    `│ › تفاعلات قليلة    : ${lowReactions}\n` +
    `│ › منشور مكرر       : ${duplicate}\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

async function _showSettingsMenu(api, event) {
  const { threadID, senderID } = event;
  const { minReactions, coinsPerReact } = await getSettings();
  await setAdminSession(senderID, { state: 'NASHR_SETTINGS_MAIN' });
  await sendMessage(api,
    `╮───∙⋆⋅「 إعدادات النشر ⚙️ 」\n` +
    `│\n` +
    `│ › الحد الأدنى للتفاعلات : ${minReactions}\n` +
    `│ › الكوينز لكل تفاعل     : ${coinsPerReact}\n` +
    `│\n` +
    `│ 1 › تغيير الحد الأدنى للتفاعلات\n` +
    `│ 2 › تغيير الكوينز لكل تفاعل\n` +
    `│ › 《 خروج 》\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

async function _showTokenDeleteMenu(api, event) {
  const { threadID, senderID } = event;
  const tokens = await getApifyTokens();

  if (!tokens.length) {
    await sendMessage(api,
      `╮───∙⋆⋅「 حذف توكن 」\n│ › لا يوجد توكنات لحذفها\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }

  let msg = `╮───∙⋆⋅「 حذف توكن 」\n│\n`;
  tokens.forEach((t, i) => {
    msg += `│ ${i + 1}. ${t.username} ${t.disabled ? '🔴' : '🟢'}\n`;
  });
  msg += `│\n│ › ارسل رقم التوكن للحذف\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`;

  await setAdminSession(senderID, {
    state : 'NASHR_TOKEN_DELETE',
    tokens: tokens.map(t => ({ _id: String(t._id), username: t.username })),
  });
  await sendMessage(api, msg, threadID);
}

// ═════════════════════════════════════════════════════════════════════
//  الصادرات
// ═════════════════════════════════════════════════════════════════════

module.exports = {
  handleKoinezNashr,
  handleNashrReply,
  handleManshourat,
  handleManshouraatSession,
};