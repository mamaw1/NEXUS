/*
 * ═══════════════════════════════════════════════════════════════════════
 *  index.js — الملف الرئيسي لبوت نيكسوس
 * ═══════════════════════════════════════════════════════════════════════
 */

const http = require('http');
const login = require('@dongdev/fca-unofficial');
const config = require('./config.json');

const {
  markBotFailed,
  setCurrentBotId,
  initAutoRotation,
  setEnvBotName,
  resolveLoginCookies,
} = require('./bot_rotation');

const { connectDB, getBots } = require('./database');
const { handleBotJoin, handleAdminGranted: _adminJoin } = require('./dukhul');
const {
  handleAdminGranted, handleAdminCommand, handleProtection,
  handleDisabledCommand, matchCommandKey, isAdmin, kickFromAllGroups, getPermanentBan,
  isBotEnabled, initBotEnabled
} = require('./admin');
const { handleTasjil, handleExternalJoin, handleExternalJoinReply, handleDMJoin } = require('./tasjil');
const { handleMalafi } = require('./malafi');
const { handleAwamer, handleAwamerPage } = require('./awamer');
const { handleTahwil } = require('./tahwil');
const { handleHafr, handleJam3, handleSayd, handleHaqiba, handleHadhf, handleIrsal, handleItemTransferSession } = require('./ta3din&ta5zin');
const { handleTasni3Menu, handleAslihah, handleDuru3, handleMawad, handleCraftItem } = require('./tasni3');
const { handleHijoom, handleTajhizDar3, handleArmorEquipReply, handleAutoEquipToggle } = require('./hijoom');
const { handleIntruderJoin, handleIntruderMessage } = require('./dakhil');
const { checkAndSendNotifications } = require('./isharat');
const { handleMatjar, handleShopBuy, handleUse, handleUseSession, getUseSession, handleSo9, handleBa3Fi, handleMarketSession, handleCode, getMarketSession } = require('./so9&matjar');
const { getKingdomByThreadId, sendMessage } = require('./utils');
const { handleAgentList, handleAgentStart, handleAgentReply, startConversationCleanup } = require('./agent');
const { cacheMessage, handleUnsend, isSpyEnabled } = require('./spy_group');
const { handleKoinezNashr, handleNashrReply } = require('./nashr');
const {
  getPlayer, getTempSession, getItemTransferSession,
  incrementMessageCount, isCommandDisabled,
  getDisabledCmdSession, setDisabledCmdSession, deleteDisabledCmdSession,
  addCommandWatcher, getJoinSession, getNashrSession
} = require('./database');

// دمج دوال دار الألعاب المتكاملة
const {
  handleDarAlal3abMenu,
  handleDarAlal3abSession,
  handleActiveGameInput,
  handleGameInvitationReply,
  handleTugOfWarReply
} = require('./dar_alal3ab');

// ===== نظام السجلات المفصّل =====
function log(level, msg, extra) {
  const time = new Date().toISOString();
  const prefix = {
    INFO:  '[ INFO ]',
    OK:    '[  OK  ]',
    WARN:  '[ WARN ]',
    ERROR: '[ERROR ]',
    FATAL: '[FATAL ]',
  }[level] || '[ LOG  ]';
  const line = `${time} ${prefix} ${msg}`;
  if (level === 'ERROR' || level === 'FATAL') {
    console.error(line, extra !== undefined ? extra : '');
  } else {
    console.log(line, extra !== undefined ? extra : '');
  }
}

// ===== خادم HTTP للتأكد أن Render لا يوقف الخدمة =====
const PORT = process.env.PORT || 3000;
let botStatus = {
  running: false,
  loginTime: null,
  lastEvent: null,
  restartCount: 0,
  lastError: null,
};

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/health' || req.url === '/') {
    const uptime = botStatus.loginTime
      ? Math.floor((Date.now() - botStatus.loginTime) / 1000)
      : 0;
    const status = botStatus.running ? 200 : 503;
    res.writeHead(status);
    res.end(JSON.stringify({
      status: botStatus.running ? 'online' : 'offline',
      uptime_seconds: uptime,
      last_event: botStatus.lastEvent,
      restart_count: botStatus.restartCount,
      last_error: botStatus.lastError,
    }, null, 2));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  }
});

server.listen(PORT, () => {
  log('OK', `خادم الصحة يعمل على البورت ${PORT} — /health`);
});

// ===== معالجة الأخطاء على مستوى العملية =====
process.on('uncaughtException', (err) => {
  botStatus.lastError = `uncaughtException: ${err.message}`;
  log('FATAL', 'خطأ غير متوقع (uncaughtException):', err);

  // خطأ المنفذ مشغول لا علاقة له بالبوت — لا نُعيد تشغيل startBot
  if (err.code === 'EADDRINUSE') {
    log('WARN', `⚠️ المنفذ ${PORT} مشغول بعملية أخرى — البوت سيستمر بدون خادم HTTP`);
    return;
  }

  log('WARN', 'سيتم إعادة التشغيل خلال 5 ثوانٍ...');
  botStatus.running = false;
  setTimeout(() => startBot(), 5000);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.stack : String(reason);
  botStatus.lastError = `unhandledRejection: ${msg}`;
  log('ERROR', 'رفض Promise غير معالج (unhandledRejection):', msg);
});

// ===== مراقب الاتصال (Watchdog) =====
let watchdogInterval = null;
let lastEventTime = Date.now();

// ===== إغلاق الـ Listener القديم عند إعادة الاتصال =====
let currentStopListening = null;

function stopCurrentListener() {
  if (typeof currentStopListening === 'function') {
    try { currentStopListening(); } catch (e) {}
    currentStopListening = null;
    log('INFO', 'تم إغلاق الـ listener القديم');
  }
}

// ===== مرشح الرسائل المكررة =====
const processedEvents = new Set();
const DEDUP_MAX = 500;

function isDuplicate(eventType, messageID) {
  if (!messageID) return false;
  const key = `${eventType}:${messageID}`;
  if (processedEvents.has(key)) return true;
  processedEvents.add(key);
  if (processedEvents.size > DEDUP_MAX) {
    const first = processedEvents.values().next().value;
    processedEvents.delete(first);
  }
  return false;
}

// ───── Keepalive ping لمنع انقطاع MQTT الصامت ─────
let keepaliveInterval = null;
let currentApi = null;

function startKeepalive(api) {
  if (keepaliveInterval) clearInterval(keepaliveInterval);
  currentApi = api;
  keepaliveInterval = setInterval(() => {
    if (!currentApi) return;
    try {
      currentApi.getFriendsList((err) => {
        if (err) {
          const msg = err.error || err.message || String(err);
          log('WARN', `⚠️ [Keepalive] الاتصال يبدو منقطعاً: ${msg}`);
          botStatus.lastError = `keepalive فشل: ${msg}`;
        } else {
          lastEventTime = Date.now();
          log('INFO', '💓 [Keepalive] الاتصال نشط');
        }
      });
    } catch (e) {
      log('WARN', `⚠️ [Keepalive] استثناء: ${e.message}`);
    }
  }, 120000);
}

function startWatchdog() {
  if (watchdogInterval) clearInterval(watchdogInterval);

  watchdogInterval = setInterval(() => {
    const silentFor = Math.floor((Date.now() - lastEventTime) / 1000);
    if (silentFor > 300) {
      botStatus.lastError = `لا يوجد نشاط منذ ${silentFor} ثانية — يُشتبه بانقطاع الاتصال`;
      log('WARN', `⚠️ Watchdog: لا يوجد نشاط منذ ${silentFor}ث — جاري إعادة الاتصال...`);
      botStatus.running = false;
      clearInterval(watchdogInterval);
      watchdogInterval = null;
      if (keepaliveInterval) { clearInterval(keepaliveInterval); keepaliveInterval = null; }
      currentApi = null;
      stopCurrentListener();
      setTimeout(() => startBot(), 3000);
    } else {
      log('INFO', `💓 Watchdog: البوت نشط — آخر حدث منذ ${silentFor}ث`);
    }
  }, 60000);
}

function getKingdomGroups() {
  return Object.values(config.groupes).map(String);
}


// دالة محاولة تسجيل الدخول كـ Promise
function tryLogin(cookies) {
  return new Promise((resolve, reject) => {
    login({ appState: cookies }, (err, api) => {
      if (err) return reject(err);
      resolve(api);
    });
  });
}

// مؤقت إنهاء التحديات تلقائياً لعدم الرد بعد دقيقة واحدة
function startGameTimeoutWatcher(api) {
  setInterval(async () => {
    try {
      const { getDB, getPlayer, updatePlayer } = require('./database');
      const db = getDB();
      const cutoff = new Date(Date.now() - 60 * 1000); // دقيقة واحدة

      const timedOutGames = await db.collection('active_game_sessions').find({
        mode: 'challenge',
        status: 'active',
        lastActivity: { $lt: cutoff }
      }).toArray();

      for (const game of timedOutGames) {
        await db.collection('active_game_sessions').deleteOne({ _id: game._id });

        const inactivePlayerId = game.turn;
        const activePlayerId = game.players.find(p => p !== inactivePlayerId);
        
        const winnerName = game.playerNames[activePlayerId];
        const loserName = game.playerNames[inactivePlayerId];

        // تعويض الفائز بالرهان المالي المزدوج
        if (game.bet > 0) {
          const winnerDoc = await getPlayer(activePlayerId);
          await updatePlayer(activePlayerId, { coins: (winnerDoc.coins || 0) + (game.bet * 2) });
        }

        const alertMsg = `⏱️ انتهت مهلة الانتظار (1 دقيقة) دون رد من اللاعب ⟦ ${loserName} ⟧!\n🏆 تم إعلان اللاعب ⟦ ${winnerName} ⟧ فائزاً بالمباراة بالانسحاب وحصل على قيمة الرهان كاملاً!`;
        
        await sendMessage(api, alertMsg, game.playerThreads[activePlayerId]);
        if (game.playerThreads[activePlayerId] !== game.playerThreads[inactivePlayerId]) {
          await sendMessage(api, alertMsg, game.playerThreads[inactivePlayerId]);
        }
      }
    } catch (err) {
      console.error('[GameWatcher] خطأ أثناء معالجة مهلة وقت الألعاب:', err);
    }
  }, 15000); // فحص مستمر كل 15 ثانية
}

// ===== دالة تشغيل البوت =====
async function startBot() {
  stopCurrentListener();
  botStatus.restartCount++;

  log('INFO', '🔄 جاري تحديد الحساب المطلوب من قاعدة البيانات...');
  const loginData = await resolveLoginCookies();

  if (!loginData) {
    log('FATAL', '🔒 لا توجد كوكيزات متاحة — تحقق من قاعدة البيانات أو المتغير البيئي.');
    botStatus.lastError = 'لا تتوفر أي حسابات';
    botStatus.running = false;
    return;
  }

  log('INFO', `🔑 جاري تسجيل الدخول بالحساب: [${loginData.botName}]`);
  let api;
  try {
    api = await tryLogin(loginData.cookies);
  } catch (err) {
    const errMsg = err.error || err.message || JSON.stringify(err);
    log('ERROR', `❌ فشل تسجيل الدخول للحساب [${loginData.botName}]: ${errMsg}`);
    if (loginData.botId) {
      await markBotFailed(loginData.botId).catch(() => {});
    }
    log('WARN', '🔄 جاري المحاولة بالحساب التالي خلال 3 ثوانٍ...');
    botStatus.lastError = `فشل تسجيل الدخول: ${errMsg}`;
    botStatus.running = false;
    setTimeout(() => startBot(), 3000);
    return;
  }

  setCurrentBotId(loginData.botId);
  botStatus.running = true;
  botStatus.loginTime = Date.now();
  lastEventTime = Date.now();
  log('OK', `✅ تم تسجيل الدخول بنجاح — الحساب النشط: ${loginData.botName}`);

  if (loginData.botId) {
    try {
      const { ObjectId } = require('mongodb');
      const { getDB } = require('./database');
      await getDB().collection('bots').updateOne(
        { _id: new ObjectId(loginData.botId) },
        { $set: { lastUsed: new Date(), status: 'active' } }
      );
    } catch (e) {}
  } else {
    try {
      const BOT_UID = String(api.getCurrentUserID());
      await setEnvBotName(`المتغير البيئي (${BOT_UID})`);
    } catch (e) {}
  }

  const BOT_ID = String(api.getCurrentUserID());
  api.setOptions({ listenEvents: true, selfListen: false });

  // تهيئة مسابقة النشر والدعوات التلقائية
  const { initCompetitions } = require('./Mosaba9at');
  initCompetitions(api).catch(err => log('ERROR', 'خطأ في تهيئة المسابقات التلقائية:', err));

  // بدء تشغيل مراقب وقت الألعاب (التحديات)
  startGameTimeoutWatcher(api);

  startConversationCleanup();
  startWatchdog();
  startKeepalive(api);

  currentStopListening = api.listen(async (err, event) => {
    if (err) {
      const errMsg = err.error || err.message || JSON.stringify(err);
      botStatus.lastError = `خطأ في الاستماع: ${errMsg}`;
      log('ERROR', '❌ خطأ في api.listen:', errMsg);

      if (errMsg.includes('login_blocked') || errMsg === 'login_blocked' ||
          errMsg.includes('Not logged in') || errMsg.includes('login') || errMsg.includes('auth')) {
        log('WARN', `🔄 انتهت الجلسة أو تم حظر الحساب الحالي — جاري الانتقال المتسلسل للحساب التالي...`);
        botStatus.running = false;
        if (watchdogInterval) { clearInterval(watchdogInterval); watchdogInterval = null; }
        if (keepaliveInterval) { clearInterval(keepaliveInterval); keepaliveInterval = null; }
        currentApi = null;
        stopCurrentListener();
        if (loginData.source === 'db' && loginData.botId) {
          await markBotFailed(loginData.botId).catch(() => {});
        }
        setTimeout(() => startBot(), 2000);
      }
      return;
    }

    lastEventTime = Date.now();
    botStatus.lastEvent = new Date().toISOString();

    if (isDuplicate(event.type, event.messageID)) return;

    try {
      if (event.type === 'message_unsend') {
        await handleUnsend(api, event);
        return;
      }

      if (event.type === 'event') {
        const lt = event.logMessageType;

        if (lt === 'log:subscribe') {
          const pids = event.participantIDs || [];
          await Promise.all([
            handleBotJoin(api, event),
            handleIntruderJoin(api, event, BOT_ID),
            ...pids.map(async (pid) => {
              const ban = await getPermanentBan(String(pid));
              if (ban) await kickFromAllGroups(api, String(pid));
            })
          ]);
          return;
        }

        if (lt === 'log:user-nickname' || lt === 'log:thread-name' || lt === 'log:thread-image') {
          await handleProtection(api, event, BOT_ID);
          return;
        }

        if (lt === 'log:thread-admins') {
          await handleAdminGranted(api, event);
        }
        return;
      }

      if (event.type !== 'message' && event.type !== 'message_reply') return;

      const { threadID, senderID, body } = event;
      const text = (body || '').trim();

      if (!event.isGroup) {
        await handleDMJoin(api, event);
        return;
      }

      cacheMessage(event);

      if (isAdmin(senderID)) {
        // ── أمر منشورات (نظام كوينز النشر) ──
        const { handleManshourat, handleManshouraatSession } = require('./nashr');
        const adminSession2 = await require('./database').getAdminSession(senderID);
        if (adminSession2?.state?.startsWith('NASHR_')) {
          await handleManshouraatSession(api, event, adminSession2);
          return;
        }
        if (text === 'منشورات') {
          await handleManshourat(api, event);
          return;
        }
        const adminHandled = await handleAdminCommand(api, event);
        if (adminHandled) return;
      }

      if (!isBotEnabled()) return;

      const isKingdomGroup = getKingdomGroups().includes(String(threadID));
      const kingdom = getKingdomByThreadId(threadID);

      if (isKingdomGroup) {
        incrementMessageCount().catch(() => {});
        checkAndSendNotifications(api, event).catch(() => {});
      }

      if (!text) return;

      // ── 1. تفاعل لعبة شد الحبل (الرد بكلمة شد) ──
      const tugHandled = await handleTugOfWarReply(api, event);
      if (tugHandled) return;

      // ── 2. تفاعل الردود على دعوات الألعاب (قبول/رفض) ──
      const inviteHandled = await handleGameInvitationReply(api, event);
      if (inviteHandled) return;

      // ── 3. تفاعل مدخلات اللعب النشط (الفردي والجماعي) ──
      const gameActiveHandled = await handleActiveGameInput(api, event);
      if (gameActiveHandled) return;

      if (text === 'ايدي') {
        const targetId = (event.messageReply && event.messageReply.senderID)
          ? String(event.messageReply.senderID)
          : String(senderID);
        const label = (event.messageReply && event.messageReply.senderID)
          ? 'ايدي الشخص'
          : 'ايدي';
        await sendMessage(api,
          `╮───∙⋆⋅「 ${label} 」\n│\n│ › ${targetId}\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
          threadID);
        return;
      }

      if (text === 'ايدي القروب') {
        await sendMessage(api,
          `╮───∙⋆⋅「 ايدي القروب 」\n│\n│ › ${threadID}\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
          threadID);
        return;
      }

      const cmdKey = matchCommandKey(text);
      const [
        disabledSession,
        tempSession,
        itemSession,
        useSession,
        marketSession,
        isDisabled,
        joinSession,
        nashrSession,
        gameMenuSession, // جلب جلسة قائمة الألعاب النشطة
      ] = await Promise.all([
        getDisabledCmdSession(senderID),
        getTempSession(senderID),
        getItemTransferSession(senderID),
        getUseSession(senderID),
        getMarketSession(senderID),
        cmdKey ? isCommandDisabled(cmdKey) : Promise.resolve(false),
        getJoinSession(senderID),
        getNashrSession(senderID),
        require('./database').getDB().collection('dar_alal3ab_sessions').findOne({ fbId: String(senderID) }),
      ]);

      if (disabledSession) {
        if (text === 'نعم') {
          await addCommandWatcher(senderID, disabledSession.cmdKey);
          await deleteDisabledCmdSession(senderID);
          const { sendReply } = require('./utils');
          await sendReply(api,
            `╮───∙⋆⋅「 تم 」\n│ › سيتم إشعارك حين يتوفر الأمر ✅️\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
            event.messageID, threadID);
        } else {
          await deleteDisabledCmdSession(senderID);
        }
        return;
      }

      if (cmdKey && isDisabled) {
        await handleDisabledCommand(api, event, cmdKey);
        return;
      }

      if (text === 'تسجيل') {
        if (isKingdomGroup) {
          await handleTasjil(api, event);
        } else {
          await handleExternalJoin(api, event);
        }
        return;
      }

      if (tempSession && isKingdomGroup) {
        await handleTasjil(api, event);
        return;
      }

      if (!isKingdomGroup && event.type === 'message_reply') {
        const repliedBody = (event.messageReply && event.messageReply.body) || '';
        if (repliedBody.includes('انضم الى عالم نيكسوس') ||
            (joinSession && joinSession.step === 'CHOOSE_KINGDOM')) {
          const handled = await handleExternalJoinReply(api, event);
          if (handled) return;
        }
      }

      if (itemSession) { await handleItemTransferSession(api, event, itemSession); return; }
      if (useSession)  { await handleUseSession(api, event, useSession); return; }
      if (marketSession) { await handleMarketSession(api, event, marketSession); return; }
      if (nashrSession) { await handleNashrReply(api, event, nashrSession); return; }

      // معالجة جلسات اختيار الألعاب
      if (gameMenuSession) {
        const handled = await handleDarAlal3abSession(api, event, gameMenuSession);
        if (handled) return;
      }

      const player = await getPlayer(senderID);

      if (isKingdomGroup && player && kingdom) {
        const isIntruder = await handleIntruderMessage(api, event, player, kingdom);
        if (isIntruder) return;
      }

      if (['اوامر','الاوامر','أوامر','الأوامر'].includes(text)) {
        await handleAwamer(api, event); return;
      }

      // === أمر فتح دار الألعاب ===
      if (['العاب', 'ألعاب', 'دار الالعاب', 'دار الألعاب'].includes(text)) {
        await handleDarAlal3abMenu(api, event);
        return;
      }

      // === أوامر المسابقات الحالية ===
      if (text === 'مسابقة النشر') {
        const { handleNashrCompetition } = require('./Mosaba9at');
        await handleNashrCompetition(api, event);
        return;
      }

      if (text === 'مسابقة الدعوات') {
        const { handleDa3waCompetition } = require('./Mosaba9at');
        await handleDa3waCompetition(api, event);
        return;
      }

      if (text === 'ايجنت') { await handleAgentList(api, event); return; }

      if (event.type === 'message_reply') {
        const agentHandled = await handleAgentReply(api, event);
        if (agentHandled) return;
      }

      if (text && text.length >= 2 && text.length <= 50) {
        const agentStarted = await handleAgentStart(api, event, text);
        if (agentStarted) return;
      }

      if (event.messageReply && /^\d+$/.test(text)) {
        const repliedBody = event.messageReply.body || '';
        if (repliedBody.includes('الاوامر.')) { await handleAwamerPage(api, event, parseInt(text, 10)); return; }
        if (repliedBody.includes('سوق نيكسوس')) { await handleSo9(api, event, parseInt(text, 10)); return; }
        if (repliedBody.includes('الدروع المتاحة')) { await handleArmorEquipReply(api, event, parseInt(text, 10)); return; }
      }

      if (['المتجر','متجر','متجر نيكسوس'].includes(text)) { await handleMatjar(api, event); return; }

      const shopMatch = text.match(/^شراء\s+(.+)$/);
      if (shopMatch) { const h = await handleShopBuy(api, event, shopMatch[1].trim()); if (h) return; }

      const useMatch = text.match(/^استعمال\s+(.+)$/);
      if (useMatch) { await handleUse(api, event, useMatch[1].trim()); return; }

      if (['السوق','سوق','سوق نيكسوس'].includes(text)) { await handleSo9(api, event, 1); return; }
      if (text === 'بيع في السوق') { await handleBa3Fi(api, event); return; }

      if (/^[A-Za-z0-9]{4}$/.test(text)) {
        const h = await handleCode(api, event, text); if (h) return;
      }

      if (text === 'ملفي') { await handleMalafi(api, event); return; }

      if (text === 'كوينز النشر') { await handleKoinezNashr(api, event); return; }

      if (/^تحويل\s+\S+\s+كوينز\s+الى\s+.+$/.test(text)) { await handleTahwil(api, event); return; }

      if (text === 'حفر' && kingdom === 'murdak')   { await handleHafr(api, event); return; }
      if (text === 'جمع' && kingdom === 'niravil')  { await handleJam3(api, event); return; }
      if (text === 'صيد' && kingdom === 'solfare')  { await handleSayd(api, event); return; }

      if (['حقيبة','حقيبتي','الحقيبة'].includes(text)) { await handleHaqiba(api, event); return; }
      if (/^حذف\s+.+$/.test(text))                   { await handleHadhf(api, event); return; }
      if (/^ارسال\s+.+\s+الى\s+.+$/.test(text))      { await handleIrsal(api, event); return; }

      if (text === 'تصنيع')                  { await handleTasni3Menu(api, event); return; }
      if (/^تصنيع\s+.+$/.test(text))         { await handleCraftItem(api, event); return; }
      if (['أسلحة','اسلحة'].includes(text))  { await handleAslihah(api, event); return; }
      if (text === 'دروع')                   { await handleDuru3(api, event); return; }
      if (text === 'مواد')                   { await handleMawad(api, event); return; }

      if (/^هجوم\s+.+\s+على\s+.+$/.test(text)) { await handleHijoom(api, event); return; }
      if (text === 'تجهيز الدرع')            { await handleTajhizDar3(api, event); return; }
      if (text === 'التجهيز التلقائي')       { await handleAutoEquipToggle(api, event); return; }

    } catch (e) {
      log('ERROR', `خطأ في معالجة الحدث [${event.type}] من [${event.senderID}]:`, e.stack || e.message);
    }
  });
}

async function start() {
  log('INFO', '🚀 بدء تشغيل بوت نيكسوس...');

  try {
    await connectDB();
    log('OK', '✅ تم الاتصال بقاعدة البيانات');
  } catch (e) {
    log('FATAL', '❌ فشل الاتصال بقاعدة البيانات:', e.message);
    process.exit(1);
  }

  const { initAdminIds, initGroupes } = require('./admin');
  const { loadSpyState } = require('./spy_group');

  try {
    await initAdminIds();
    await initGroupes();
    await loadSpyState();
    await initBotEnabled();
    log('OK', '✅ تم تحميل بيانات الإدارة والمجموعات');
  } catch (e) {
    log('ERROR', '⚠️ خطأ في تحميل بيانات الإدارة:', e.message);
  }

  // دالة إعادة التشغيل الداخلية — تُوقف كل شيء وتبدأ startBot من جديد
  // تُسجَّل في bot_rotation حتى يستطيع admin2.js استدعاءها
  await initAutoRotation(() => {
    log('INFO', '🔄 [Restart] تم طلب إعادة التشغيل...');
    botStatus.running = false;
    if (watchdogInterval) { clearInterval(watchdogInterval); watchdogInterval = null; }
    if (keepaliveInterval) { clearInterval(keepaliveInterval); keepaliveInterval = null; }
    currentApi = null;
    stopCurrentListener();
    setTimeout(() => startBot(), 1500);
  });

  await startBot();
}

start();