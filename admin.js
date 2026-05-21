/*
 * ═══════════════════════════════════════════════════════════════════════
 *  الجزء الأول: admin.js — إدارة اللاعبين والأوامر
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  الوظائف والمحتويات:
 *  ───────────────────────────────────────────────────────────────────
 *  1. الأدمنز          : initAdminIds / initGroupes / isAdmin
 *  2. أدوات مساعدة    : downloadPhoto, kickUser, addUserToGroup,
 *                         kickFromAllGroups, resolveTarget, setTitle
 *  3. قائمة الأوامر   : COMMAND_LIST, matchCommandKey
 *  4. القائمة الرئيسية: handleAdminMenu — يضم أوامر تشغيل/ايقاف البوت
 *  5. المشرفون        : ادمن اضافة / ادمن حذف / المشرفون
 *  6. بيانات          : إحصاءات اللاعبين والرسائل والاقتصاد
 *  7. تعديل           : تعديل أسماء وصور القروبات
 *  8. معلومات         : عرض لاعبي مملكة أو ملف لاعب
 *  9. بانكاي          : طرد لاعب من كل القروبات
 * 10. بانكاي مؤبد     : طرد + حظر دائم + حذف بيانات اللاعب
 * 11. حذف             : حذف بيانات لاعب من قاعدة البيانات
 * 12. الحظر           : عرض المحظورين وإلغاء الحظر
 * 13. اشعار           : إرسال إشعار لمملكة أو الكل
 * 14. تعطيل / تشغيل   : تعطيل/تشغيل أوامر اللاعبين
 * 15. اضافة           : إضافة الأدمن لقروب أو الكل
 * 16. handleAdminGranted: إشعار منح صلاحيات الأدمن
 * 17. handleDisabledCommand: إشعار اللاعب بأن الأمر معطل
 * 18. handleAdminCommand: الموجّه الرئيسي لجميع أوامر الأدمن
 *  ───────────────────────────────────────────────────────────────────
 *  يستورد من admin2.js: البوتات، تبديل، اعادة ضبط، الحماية،
 *  ريست، قاعدة البيانات، القروبات، الذكاء الاصطناعي،
 *  تشغيل البوت، ايقاف البوت.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs   = require('fs');
const path = require('path');
const config = require('./config.json');

const {
  sendMessage, sendReply, extractFbId, kingdomNamesAr,
  classSymbols, generateNickname, getKingdomByThreadId
} = require('./utils');

const {
  getPlayer, getPlayerByNickname, deletePlayer, getAllPlayers,
  addPermanentBan, getPermanentBan, getAllPermanentBans, removePermanentBan,
  getAdminSession, setAdminSession, deleteAdminSession,
  disableCommand, enableCommand, getDisabledCommands,
  addCommandWatcher, getCommandWatchers, clearCommandWatchers,
  getMessageStats, getGroupSetting, updateGroupSetting,
  getDB, addNotification, setDisabledCmdSession,
  getBotConfig, setBotConfig,
} = require('./database');

const { markBotDeleted, setSpyEnabled, isSpyEnabled } = require('./spy_group');

// ─── استيراد كل وظائف الجزء الثاني ───────────────────────────────
const {
  initBotEnabled, isBotEnabled, handleBotStop, handleBotStart,
  handleBotaat, handleBotaatSession,
  handleTabdeel, handleTabdeelSession,
  handleEadatDabt,
  handleHimaya, handleHimayaSession, handleProtection,
  handleReset,
  handleQaeedaDB, handleQaeedaDBSession,
  handleQarobaat, handleQarobaatSession,
  handleNexusAI, handleZakira, handleNexusAISession,
  snapshotGroupPhotos,
} = require('./admin2');

const ADMIN_ID = String(config.adminId);

// ═════════════════════════════════════════════════════════════════════
//   إدارة الأدمنز المتعددين
// ═════════════════════════════════════════════════════════════════════

let extraAdmins = new Set();

async function initAdminIds() {
  const stored = await getBotConfig('adminIds');
  extraAdmins = stored && Array.isArray(stored)
    ? new Set(stored.map(String))
    : new Set((config.adminIds || []).map(String));
}

async function initGroupes() {
  const stored = await getBotConfig('groupes');
  if (stored && typeof stored === 'object') Object.assign(config.groupes, stored);
}

async function saveAdminIds() { await setBotConfig('adminIds', [...extraAdmins]); }

function isAdmin(senderID) {
  const id = String(senderID);
  return id === ADMIN_ID || extraAdmins.has(id);
}

// ═════════════════════════════════════════════════════════════════════
//   أدوات مساعدة
// ═════════════════════════════════════════════════════════════════════

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

function setTitle(api, title, threadID) {
  return new Promise((resolve) => {
    try { api.setTitle(title, threadID, () => resolve()); }
    catch (e) { resolve(); }
  });
}

function kickUser(api, fbId, threadID) {
  return new Promise((resolve) => {
    try { api.removeUserFromGroup(String(fbId), threadID, (err) => resolve(!err)); }
    catch (e) { resolve(false); }
  });
}

function addUserToGroup(api, fbId, threadID) {
  return new Promise((resolve) => {
    try { api.addUserToGroup(String(fbId), threadID, (err) => resolve(!err)); }
    catch (e) { resolve(false); }
  });
}

async function kickFromAllGroups(api, fbId) {
  for (const gid of Object.values(config.groupes).map(String)) {
    await kickUser(api, fbId, gid);
  }
}

async function resolveTarget(text, event) {
  if (event && event.messageReply && (!text || text.trim() === '')) {
    const targetId = String(event.messageReply.senderID);
    return { player: await getPlayer(targetId), fbId: targetId };
  }
  const t = (text || '').trim();
  if (/^\d{10,}$/.test(t)) return { player: await getPlayer(t), fbId: t };
  const extracted = extractFbId(t);
  if (extracted) return { player: await getPlayer(extracted), fbId: extracted };
  const player = await getPlayerByNickname(t);
  if (player) return { player, fbId: player.fbId };
  return { player: null, fbId: null };
}

// ═════════════════════════════════════════════════════════════════════
//   قائمة الأوامر القابلة للتعطيل
// ═════════════════════════════════════════════════════════════════════

const COMMAND_LIST = [
  { key: 'tasjil',     name: 'تسجيل' },
  { key: 'malafi',     name: 'ملفي' },
  { key: 'haqiba',     name: 'الحقيبة' },
  { key: 'tahwil',    name: 'تحويل كوينز' },
  { key: 'hafr',      name: 'حفر' },
  { key: 'jam3',      name: 'جمع' },
  { key: 'sayd',      name: 'صيد' },
  { key: 'hadhf_bag', name: 'حذف (من الحقيبة)' },
  { key: 'irsal',     name: 'ارسال غرض' },
  { key: 'tasni3',    name: 'تصنيع' },
  { key: 'matjar',    name: 'المتجر' },
  { key: 'shira2',    name: 'شراء' },
  { key: 'isti3mal',  name: 'استعمال' },
  { key: 'so9',       name: 'السوق' },
  { key: 'ba3fi',     name: 'بيع في السوق' },
];

function matchCommandKey(text) {
  if (text === 'تسجيل') return 'tasjil';
  if (text === 'ملفي') return 'malafi';
  if (['حقيبة','حقيبتي','الحقيبة'].includes(text)) return 'haqiba';
  if (/^تحويل\s+\S+\s+كوينز\s+الى\s+.+$/.test(text)) return 'tahwil';
  if (text === 'حفر') return 'hafr';
  if (text === 'جمع') return 'jam3';
  if (text === 'صيد') return 'sayd';
  if (/^حذف\s+.+$/.test(text)) return 'hadhf_bag';
  if (/^ارسال\s+.+\s+الى\s+.+$/.test(text)) return 'irsal';
  if (text === 'تصنيع' || /^تصنيع\s+.+$/.test(text)) return 'tasni3';
  if (['المتجر','متجر','متجر نيكسوس'].includes(text)) return 'matjar';
  if (/^شراء\s+.+$/.test(text)) return 'shira2';
  if (/^استعمال\s+.+$/.test(text)) return 'isti3mal';
  if (['السوق','سوق','سوق نيكسوس'].includes(text)) return 'so9';
  if (text === 'بيع في السوق') return 'ba3fi';
  return null;
}

// ═════════════════════════════════════════════════════════════════════
//   القائمة الرئيسية (تحتوي على أوامر تشغيل/ايقاف البوت)
// ═════════════════════════════════════════════════════════════════════

async function handleAdminMenu(api, event) {
  const msg =
    `╮───∙⋆⋅「 نيكسوس 」\n` +
    `│ › بيانات\n│ › معلومات\n│ › تعديل\n│ › بانكاي\n│ › بانكاي مؤبد\n` +
    `│ › حذف\n│ › الحظر\n│ › اشعار\n│ › تعطيل\n│ › تشغيل\n│ › مسح\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙───────◈\n\n` +
    `╮───∙⋆⋅「 ادارة 」\n` +
    `│ › البوتات\n│ › تبديل\n│ › طرد\n│ › اعادة ضبط\n` +
    `│ › الحماية\n│ › قاعدة البيانات\n│ › القروبات\n` +
    `│ › اضافة\n│ › جاسوس\n│ › المشرفون\n` +
    `│ › ريست\n│ › تشغيل البوت\n│ › ايقاف البوت\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙───────◈\n\n` +
    `╮───∙⋆⋅「 الذكاء الاصطناعي 」\n` +
    `│ › الوكلاء\n│ › ذاكرة\n│ › ذاكرة تحديد [رقم]\n` +
    `│ › ذاكرة وقت [دقائق]\n│ › ذاكرة مسح\n│ › ذاكرة مسح [اسم]\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙───────◈`;
  await sendMessage(api, msg, event.threadID);
}

// ═════════════════════════════════════════════════════════════════════
//   إدارة المشرفين
// ═════════════════════════════════════════════════════════════════════

async function handleMoshrefeen(api, event) {
  const list = [...extraAdmins];
  if (list.length === 0) {
    await sendMessage(api,
      `╮───∙⋆⋅「 المشرفون 」\n│\n│ › لا يوجد مشرفون مضافون\n│\n│ ادمن اضافة [ايدي / رابط]\n│ ادمن حذف [ايدي / رابط]\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      event.threadID); return;
  }
  const lines = list.map((id, i) => `│ ${i + 1}. ${id}`).join('\n');
  await sendMessage(api,
    `╮───∙⋆⋅「 المشرفون 」\n${lines}\n│\n│ ادمن اضافة [ايدي / رابط]\n│ ادمن حذف [ايدي / رابط]\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    event.threadID);
}

async function handleAdminAdd(api, event, arg) {
  const id = extractFbId(arg.trim());
  if (!id) { await sendMessage(api, `╮───∙⋆⋅「 ادمن اضافة 」\n│\n│ › تعذّر استخراج الايدي\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID); return; }
  if (id === ADMIN_ID) { await sendMessage(api, `╮───∙⋆⋅「 ادمن اضافة 」\n│\n│ › هذا هو الأدمن الرئيسي بالفعل\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID); return; }
  if (extraAdmins.has(id)) { await sendMessage(api, `╮───∙⋆⋅「 ادمن اضافة 」\n│\n│ › مشرف بالفعل (${id})\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID); return; }
  extraAdmins.add(id); await saveAdminIds();
  await sendMessage(api, `╮───∙⋆⋅「 ادمن اضافة 」\n│\n│ › ✅ تمت الإضافة\n│ › الايدي: ${id}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID);
}

async function handleAdminRemove(api, event, arg) {
  const id = extractFbId(arg.trim());
  if (!id) { await sendMessage(api, `╮───∙⋆⋅「 ادمن حذف 」\n│\n│ › تعذّر استخراج الايدي\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID); return; }
  if (id === ADMIN_ID) { await sendMessage(api, `╮───∙⋆⋅「 ادمن حذف 」\n│\n│ › لا يمكن حذف الأدمن الرئيسي\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID); return; }
  if (!extraAdmins.has(id)) { await sendMessage(api, `╮───∙⋆⋅「 ادمن حذف 」\n│\n│ › ليس في قائمة المشرفين\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID); return; }
  extraAdmins.delete(id); await saveAdminIds();
  await sendMessage(api, `╮───∙⋆⋅「 ادمن حذف 」\n│\n│ › ✅ تم الحذف\n│ › الايدي: ${id}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID);
}

// ═════════════════════════════════════════════════════════════════════
//   اضافة للقروبات
// ═════════════════════════════════════════════════════════════════════

async function handleIdafa(api, event) {
  const { threadID, senderID } = event;
  await setAdminSession(senderID, { state: 'IDAFA_SELECT' });
  await sendMessage(api,
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n     ✦  اضافة للقروبات  ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `╮───∙⋆⋅「 اختر القروب 」\n│ 1 › سولفارا\n│ 2 › نيرافيل\n│ 3 › مورداك\n│ 4 › الكل\n│ 5 › خروج\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

async function handleIdafaSession(api, event, session) {
  const { threadID, senderID } = event;
  const text = (event.body || '').trim();
  const arNames = { solfare: 'سولفارا', niravil: 'نيرافيل', murdak: 'مورداك' };

  if (text === 'خروج' || text === '5') {
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
  }
  const map = { '1':'solfare','2':'niravil','3':'murdak','4':'all' };
  const choice = map[text];
  if (!choice) { await sendMessage(api, `⚠️ اختر رقماً من 1 إلى 5`, threadID); return; }

  await deleteAdminSession(senderID);

  if (choice === 'all') {
    const results = [];
    for (const [k, gid] of Object.entries(config.groupes)) {
      const ok = await addUserToGroup(api, senderID, String(gid));
      results.push(`│ › ${arNames[k] || k} : ${ok ? '✅' : '❌'}`);
    }
    await sendMessage(api, `╮───∙⋆⋅「 اضافة للكل 」\n${results.join('\n')}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
  } else {
    const gid = config.groupes[choice];
    if (!gid) { await sendMessage(api, `╮───∙⋆⋅「 اضافة 」\n│\n│ › لم يتم تحديد ايدي هذا القروب\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
    const ok = await addUserToGroup(api, senderID, String(gid));
    await sendMessage(api, `╮───∙⋆⋅「 اضافة 」\n│\n│ › المملكة : ${arNames[choice]}\n│ › النتيجة : ${ok ? '✅ تمت الإضافة' : '❌ فشلت الإضافة'}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
  }
}

// ═════════════════════════════════════════════════════════════════════
//   بيانات
// ═════════════════════════════════════════════════════════════════════

async function handleBayaanat(api, event) {
  const { threadID } = event;
  const allPlayers = await getAllPlayers();
  const total = allPlayers.length;
  const kingdoms = ['solfare', 'niravil', 'murdak'];
  let perKingdom = {}, coinsKingdom = {}, totalCoins = 0;
  for (const k of kingdoms) {
    const kp = allPlayers.filter(p => p.kingdom === k && p.fbId !== ADMIN_ID);
    perKingdom[k] = kp.length;
    coinsKingdom[k] = kp.reduce((s, p) => s + (p.coins || 0), 0);
    totalCoins += coinsKingdom[k];
  }
  const msgStats = await getMessageStats();
  let marketCount = 0;
  try { marketCount = await getDB().collection('market').countDocuments({ status: 'active' }); } catch (e) {}
  let groupLines = '';
  for (const k of kingdoms) {
    const s = await getGroupSetting(k);
    const gName = (s && s.customName) ? s.customName : `مملكة ${kingdomNamesAr[k]}`;
    groupLines += `│ › ${kingdomNamesAr[k]}  ┇ ${gName}  [ ${perKingdom[k]} لاعب ]\n`;
  }
  await sendMessage(api,
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n     ✦ بيانات نيكسوس ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `╮───∙⋆⋅「 اللاعبون 」\n│ › الإجمالي : ${total} لاعب\n${groupLines}╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 الرسائل 」\n│ › اليوم   : ${msgStats.today}\n│ › الأسبوع : ${msgStats.week}\n│ › الشهر   : ${msgStats.month}\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 الاقتصاد 」\n│ › إجمالي الكوينز : ${totalCoins}\n│ › سولفارا : ${coinsKingdom['solfare']}\n│ › نيرافيل : ${coinsKingdom['niravil']}\n│ › مورداك  : ${coinsKingdom['murdak']}\n│ › السلع في السوق : ${marketCount}\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

// ═════════════════════════════════════════════════════════════════════
//   تعديل القروبات
// ═════════════════════════════════════════════════════════════════════

async function handleTa3deel(api, event) {
  const { threadID, senderID } = event;
  await setAdminSession(senderID, { state: 'DATA_MAIN' });
  await sendMessage(api,
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n         ✦ تعديل القروبات ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `╮───∙⋆⋅「 الخيارات 」\n│ 1 › تعديل اسم سولفارا\n│ 2 › تعديل اسم نيرافيل\n│ 3 › تعديل اسم مورداك\n` +
    `│ 4 › تعديل صورة سولفارا\n│ 5 › تعديل صورة نيرافيل\n│ 6 › تعديل صورة مورداك\n│ 7 › خروج\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

async function handleDataSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();
  if (text === 'خروج' || text === '7') { await deleteAdminSession(senderID); await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  if (session.state === 'DATA_MAIN') {
    const kMap = { '1':'solfare','2':'niravil','3':'murdak','4':'solfare','5':'niravil','6':'murdak' };
    if (['1','2','3'].includes(text)) {
      await setAdminSession(senderID, { state: 'DATA_AWAIT_NAME', kingdom: kMap[text] });
      await sendMessage(api, `╮───∙⋆⋅「 تعديل الاسم 」\n│\n│ › ارسل الاسم الجديد لـ ${kingdomNamesAr[kMap[text]]}\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
    }
    if (['4','5','6'].includes(text)) {
      await setAdminSession(senderID, { state: 'DATA_AWAIT_PHOTO', kingdom: kMap[text] });
      await sendMessage(api, `╮───∙⋆⋅「 تعديل الصورة 」\n│\n│ › ارسل الصورة الجديدة لـ ${kingdomNamesAr[kMap[text]]}\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
    }
    await sendMessage(api, `⚠️ اختر رقماً من 1 إلى 7`, threadID); return;
  }
  if (session.state === 'DATA_AWAIT_NAME') {
    const k = session.kingdom;
    await updateGroupSetting(k, { customName: text, defaultName: text });
    const gid = config.groupes[k]; if (gid) await setTitle(api, text, gid);
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم التعديل 」\n│\n│ › اسم ${kingdomNamesAr[k]} : ${text}\n│ › تم حفظه كاسم افتراضي ✅️\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
  }
  if (session.state === 'DATA_AWAIT_PHOTO') {
    const k = session.kingdom;
    const photo = (event.attachments || []).find(a => a.type === 'photo' || a.type === 'sticker');
    if (!photo) { await sendMessage(api, `⚠️ لم يتم إرسال صورة، أرسل صورة أو 《 خروج 》`, threadID); return; }
    const photoUrl = photo.url || photo.previewUrl || photo.largePreviewUrl;
    if (!photoUrl) { await sendMessage(api, `⚠️ تعذر الحصول على رابط الصورة`, threadID); return; }
    const gid = config.groupes[k];
    const tmp = path.join(require('os').tmpdir(), `group_photo_${Date.now()}.jpg`);
    let photoBase64 = null;
    try {
      await downloadPhoto(photoUrl, tmp);
      photoBase64 = require('fs').readFileSync(tmp).toString('base64');
    } catch (e) { console.error('خطأ تنزيل صورة القروب:', e); }
    await updateGroupSetting(k, { photoUrl, defaultPhotoUrl: photoUrl, photoBase64 });
    // تحديث snapshot الحماية فوراً بعد حفظ الصورة
    try { await snapshotGroupPhotos(); } catch (e) { console.error('خطأ تحديث snapshot الصور:', e.message); }
    if (gid && photoBase64) {
      try {
        await new Promise(r => api.changeGroupImage(fs.createReadStream(tmp), gid, () => { try { require('fs').unlinkSync(tmp); } catch (_) {} r(); }));
      } catch (e) { console.error('خطأ تغيير صورة القروب:', e); }
    } else { try { require('fs').unlinkSync(tmp); } catch (_) {} }
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم التعديل 」\n│\n│ › تم تحديث صورة ${kingdomNamesAr[k]} ✅️\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
  }
}

// ═════════════════════════════════════════════════════════════════════
//   معلومات
// ═════════════════════════════════════════════════════════════════════

async function handleMa3loomat(api, event, args) {
  const { threadID, senderID } = event;
  if (args && args.trim()) { await showPlayerInfo(api, event, args.trim()); return; }
  await setAdminSession(senderID, { state: 'MA3LOOMAT_MAIN' });
  await sendMessage(api,
    `╮───∙⋆⋅「 معلومات 」\n│\n│ › اختر المملكة :\n│ 1 › سولفارا\n│ 2 › نيرافيل\n│ 3 › مورداك\n│\n│ › او ارسل لقب لاعب\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

async function handleMa3looomatSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();
  if (text === 'خروج') { await deleteAdminSession(senderID); await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  const kMap = { '1':'solfare','2':'niravil','3':'murdak' };
  if (kMap[text]) { await deleteAdminSession(senderID); await showKingdomPlayers(api, event, kMap[text]); return; }
  await deleteAdminSession(senderID); await showPlayerInfo(api, event, text);
}

async function showKingdomPlayers(api, event, kingdom) {
  const { threadID } = event;
  const players = await getAllPlayers(kingdom);
  if (!players || !players.length) { await sendMessage(api, `╮───∙⋆⋅「 ${kingdomNamesAr[kingdom]} 」\n│ › لا يوجد لاعبون مسجلون\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  const sorted = players.sort((a, b) => (a.level || 1) - (b.level || 1));
  let msg = `╮───∙⋆⋅「 لاعبو ${kingdomNamesAr[kingdom]} 」\n│\n`;
  sorted.forEach((p, i) => { const sym = classSymbols[p.class] || '✹'; msg += `│ ${i + 1}. ${sym} ${p.nickname}\n│    ↳ مستوى ${p.level || 1} ┇ ${p.rank || 'مجند'}\n`; });
  msg += `│\n│ › الإجمالي : ${players.length} لاعب\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
  await sendMessage(api, msg, threadID);
}

async function showPlayerInfo(api, event, query) {
  const { threadID } = event;
  const { player } = await resolveTarget(query, null);
  if (!player) { await sendMessage(api, `⚠️ لم يتم العثور على اللاعب : ${query}`, threadID); return; }
  const sym = classSymbols[player.class] || '✹';
  const bag = (player.bag || []).map(i => `${i.name} x${i.quantity}`).join(', ') || 'فارغة';
  await sendMessage(api,
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n  ✦ ملف اللاعب - أدمن ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `╮───∙⋆⋅「 البيانات 」\n│ › اللقب    : ${player.nickname}\n│ › المملكة  : ${kingdomNamesAr[player.kingdom] || player.kingdom}\n│ › الفئة    : ${player.class} ${sym}\n│ › الرتبة   : ${player.rank || 'مجند'}\n│ › المستوى  : ${player.level || 1}\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 الإحصائيات 」\n│ › HP : ${player.hp || 1000}\n│ › EP : ${player.ep || 1000}\n│ › الكوينز : ${player.coins || 0}\n│ › الايدي  : ${player.fbId}\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 الحقيبة 」\n│ › ${bag}\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 أخرى 」\n│ › دعاه : ${player.invitedBy || 'لا أحد'}\n│ › التسجيل : ${player.registeredAt ? new Date(player.registeredAt).toLocaleDateString('ar') : 'غير محدد'}\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

// ═════════════════════════════════════════════════════════════════════
//   بانكاي / طرد / بانكاي مؤبد / حذف لاعب
// ═════════════════════════════════════════════════════════════════════

async function handleBayaat(api, event, targetText) {
  const { threadID, senderID } = event;
  if (!targetText && !event.messageReply) {
    await setAdminSession(senderID, { state: 'BAYAAT_TARGET' });
    await sendMessage(api, `╮───∙⋆⋅「 بانكاي 」\n│\n│ › ارسل لقب اللاعب او ايدي او رابط\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
  }
  const { player, fbId } = await resolveTarget(targetText, event);
  if (!fbId) { await sendMessage(api, `⚠️ لم يتم العثور على اللاعب`, threadID); return; }
  await kickFromAllGroups(api, fbId);
  const nickname = player ? player.nickname : fbId;
  await sendMessage(api, event.messageReply ? `⌯ اللاعب  › ${nickname}\n✧ بلع البانكاي بنجاح 🚮 ✅️` : `✧ بلع البانكاي بنجاح 🚮 ✅️`, threadID);
}

async function handleBayaatMoabad(api, event, targetText) {
  const { threadID, senderID } = event;
  if (!targetText && !event.messageReply) {
    await setAdminSession(senderID, { state: 'BAYAAT_MOABAD_TARGET' });
    await sendMessage(api, `╮───∙⋆⋅「 بانكاي مؤبد 」\n│\n│ › ارسل لقب اللاعب او ايدي او رابط\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
  }
  const { player, fbId } = await resolveTarget(targetText, event);
  if (!fbId) { await sendMessage(api, `⚠️ لم يتم العثور على اللاعب`, threadID); return; }
  const nickname = player ? player.nickname : fbId;
  await addPermanentBan(fbId, nickname);
  await kickFromAllGroups(api, fbId);
  if (player) await deletePlayer(fbId);
  await sendMessage(api, event.messageReply ? `⌯ اللاعب  › ${nickname}\n✧ بلع البانكاي بنجاح 🚮 ✅️\n⌯ الحظر › مؤبد 🔒` : `✧ بلع البانكاي بنجاح 🚮 ✅️\n⌯ الحظر › مؤبد 🔒`, threadID);
}

async function handleHadhfAdmin(api, event, targetText) {
  const { threadID, senderID } = event;
  if (!targetText && !event.messageReply) {
    await setAdminSession(senderID, { state: 'HADHF_TARGET' });
    await sendMessage(api, `╮───∙⋆⋅「 حذف لاعب 」\n│\n│ › ارسل لقب اللاعب او ايدي او رابط\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
  }
  const { player, fbId } = await resolveTarget(targetText, event);
  if (!fbId || !player) { await sendMessage(api, `⚠️ اللاعب غير موجود في قاعدة البيانات`, threadID); return; }
  await deletePlayer(fbId);
  await sendMessage(api, `╮───∙⋆⋅「 حذف اللاعب 」\n│\n│ › اللاعب : ${player.nickname}\n│ › تم حذف بياناته ✅️\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
}

// ═════════════════════════════════════════════════════════════════════
//   الحظر
// ═════════════════════════════════════════════════════════════════════

async function handleHazar(api, event) {
  const { threadID, senderID } = event;
  const bans = await getAllPermanentBans();
  if (!bans || !bans.length) { await sendMessage(api, `╮───∙⋆⋅「 الحظر 」\n│\n│ › لا يوجد أي شخص محظور\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  let msg = `╮───∙⋆⋅「 المحظورون 」\n│\n`;
  bans.forEach((b, i) => { msg += `│ ${i + 1}. ${b.nickname}\n`; });
  msg += `│\n│ › ارسل رقم اللاعب لإلغاء حظره\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
  await setAdminSession(senderID, { state: 'HAZAR_LIST', bans: bans.map(b => ({ fbId: b.fbId, nickname: b.nickname })) });
  await sendMessage(api, msg, threadID);
}

async function handleHazarSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();
  if (text === 'خروج') { await deleteAdminSession(senderID); await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  const bans = session.bans || [], idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= bans.length) { await sendMessage(api, `⚠️ رقم غير صحيح`, threadID); return; }
  await removePermanentBan(bans[idx].fbId);
  await deleteAdminSession(senderID);
  await sendMessage(api, `╮───∙⋆⋅「 إلغاء الحظر 」\n│\n│ › ${bans[idx].nickname}\n│ › تم رفع الحظر ✅️\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
}

// ═════════════════════════════════════════════════════════════════════
//   اشعار
// ═════════════════════════════════════════════════════════════════════

async function handleIshaarAdmin(api, event) {
  const { threadID, senderID } = event;
  await setAdminSession(senderID, { state: 'ISHAAR_KINGDOM' });
  await sendMessage(api, `╮───∙⋆⋅「 إشعار 」\n│\n│ › اختر المملكة :\n│ 1 › سولفارا\n│ 2 › نيرافيل\n│ 3 › مورداك\n│ 4 › الكل\n│\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
}

async function handleIshaarSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();
  if (text === 'خروج') { await deleteAdminSession(senderID); await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  if (session.state === 'ISHAAR_KINGDOM') {
    const kMap = { '1':'solfare','2':'niravil','3':'murdak','4':'all' };
    if (!kMap[text]) { await sendMessage(api, `⚠️ اختر رقماً من 1 إلى 4`, threadID); return; }
    await setAdminSession(senderID, { state: 'ISHAAR_TEXT', kingdom: kMap[text] });
    await sendMessage(api, `╮───∙⋆⋅「 إشعار › ${text === '4' ? 'جميع الممالك' : kingdomNamesAr[kMap[text]]} 」\n│\n│ › اكتب نص الإشعار\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
  }
  if (session.state === 'ISHAAR_TEXT') {
    const k = session.kingdom;
    const players = await getAllPlayers(k === 'all' ? null : k);
    let count = 0;
    for (const p of players) { if (p.fbId === ADMIN_ID) continue; await addNotification(p.fbId, `📢 إشعار من الإدارة :\n${text}`); count++; }
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم الإشعار 」\n│\n│ › أُرسل إلى : ${k === 'all' ? 'جميع الممالك' : kingdomNamesAr[k]}\n│ › عدد المستقبلين : ${count}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
  }
}

// ═════════════════════════════════════════════════════════════════════
//   تعطيل / تشغيل الأوامر
// ═════════════════════════════════════════════════════════════════════

async function handleTatleel(api, event) {
  const { threadID, senderID } = event;
  const disabled = await getDisabledCommands();
  const disabledKeys = disabled.map(d => d.key);
  const active = COMMAND_LIST.filter(c => !disabledKeys.includes(c.key));
  if (!active.length) { await sendMessage(api, `╮───∙⋆⋅「 تعطيل 」\n│\n│ › جميع الأوامر معطلة بالفعل\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  let msg = `╮───∙⋆⋅「 تعطيل أمر 」\n│\n`;
  active.forEach((c, i) => { msg += `│ ${i + 1}. ${c.name}\n`; });
  msg += `│\n│ › ارسل رقم الأمر\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
  await setAdminSession(senderID, { state: 'TATLEEL_CHOOSE', activeList: active });
  await sendMessage(api, msg, threadID);
}

async function handleTatleelSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();
  if (text === 'خروج') { await deleteAdminSession(senderID); await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  const list = session.activeList || [], idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= list.length) { await sendMessage(api, `⚠️ رقم غير صحيح`, threadID); return; }
  await disableCommand(list[idx].key);
  await deleteAdminSession(senderID);
  await sendMessage(api, `╮───∙⋆⋅「 تعطيل 」\n│\n│ › تم تعطيل : ${list[idx].name} ✅️\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
}

async function handleTashgeel(api, event) {
  const { threadID, senderID } = event;
  const disabled = await getDisabledCommands();
  if (!disabled || !disabled.length) { await sendMessage(api, `╮───∙⋆⋅「 تشغيل 」\n│\n│ › لا توجد أوامر معطلة\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  const namedList = disabled.map(d => { const f = COMMAND_LIST.find(c => c.key === d.key); return { key: d.key, name: f ? f.name : d.key }; });
  let msg = `╮───∙⋆⋅「 تشغيل أمر 」\n│\n`;
  namedList.forEach((c, i) => { msg += `│ ${i + 1}. ${c.name}\n`; });
  msg += `│\n│ › ارسل رقم الأمر\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
  await setAdminSession(senderID, { state: 'TASHGEEL_CHOOSE', disabledList: namedList });
  await sendMessage(api, msg, threadID);
}

async function handleTashgeelSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();
  if (text === 'خروج') { await deleteAdminSession(senderID); await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  const list = session.disabledList || [], idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= list.length) { await sendMessage(api, `⚠️ رقم غير صحيح`, threadID); return; }
  const cmd = list[idx];
  await enableCommand(cmd.key);
  const watchers = await getCommandWatchers(cmd.key);
  for (const w of watchers) await addNotification(w.fbId, `✅ الأمر 《 ${cmd.name} 》 متاح الآن !`);
  await clearCommandWatchers(cmd.key);
  await deleteAdminSession(senderID);
  await sendMessage(api, `╮───∙⋆⋅「 تشغيل 」\n│\n│ › تم تشغيل : ${cmd.name} ✅️\n│ › أُشعر ${watchers.length} لاعب\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
}

// ═════════════════════════════════════════════════════════════════════
//   منح صلاحية الأدمن
// ═════════════════════════════════════════════════════════════════════

async function handleAdminGranted(api, event) {
  const kingdom = getKingdomByThreadId(event.threadID);
  if (!kingdom) return;
  try {
    await sendMessage(api,
      `╗═════━━━━━═════╔\n ┇            𝑨𝑫𝑴𝑰𝑵 ☑            ┇  \n╝═════━━━━━═════╚`,
      event.threadID);
  } catch (e) {}
}

// ═════════════════════════════════════════════════════════════════════
//   معالج الأوامر المعطلة (للاعبين)
// ═════════════════════════════════════════════════════════════════════

async function handleDisabledCommand(api, event, cmdKey) {
  const { senderID, messageID, threadID } = event;
  const cmdInfo = COMMAND_LIST.find(c => c.key === cmdKey);
  const cmdName = cmdInfo ? cmdInfo.name : cmdKey;
  await setDisabledCmdSession(senderID, { cmdKey });
  await sendReply(api,
    `╮───∙⋆⋅「 تنبيه 」\n│\n│ › الأمر 《 ${cmdName} 》 متوقف حالياً\n│\n│ هل تود الإشعار حين يتوفر ؟\n│ 《 نعم 》  《 لا 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    messageID, threadID);
}

// ═════════════════════════════════════════════════════════════════════
//   الموجّه الرئيسي لأوامر الأدمن
// ═════════════════════════════════════════════════════════════════════


async function handleAdminCommand(api, event) {
  const { senderID, body } = event;
  if (!isAdmin(senderID)) return false;

  const text = (body || '').trim();

  // ── أوامر تشغيل/ايقاف البوت — تعمل دائماً حتى وإن كان البوت متوقفاً ──
  if (text === 'تشغيل البوت') { await handleBotStart(api, event); return true; }
  if (text === 'ايقاف البوت') { await handleBotStop(api, event);  return true; }

  const adminSession = await getAdminSession(senderID);

  if (adminSession) {
    const s = adminSession.state;

    if (text === 'خروج') {
      await deleteAdminSession(senderID);
      await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID);
      return true;
    }

    if (s === 'DATA_MAIN' || s === 'DATA_AWAIT_NAME' || s === 'DATA_AWAIT_PHOTO')    { await handleDataSession(api, event, adminSession); return true; }
    if (s === 'MA3LOOMAT_MAIN')                                                       { await handleMa3looomatSession(api, event, adminSession); return true; }
    if (s === 'HAZAR_LIST')                                                           { await handleHazarSession(api, event, adminSession); return true; }
    if (s === 'ISHAAR_KINGDOM' || s === 'ISHAAR_TEXT')                               { await handleIshaarSession(api, event, adminSession); return true; }
    if (s === 'TATLEEL_CHOOSE')                                                       { await handleTatleelSession(api, event, adminSession); return true; }
    if (s === 'TASHGEEL_CHOOSE')                                                      { await handleTashgeelSession(api, event, adminSession); return true; }
    if (['BOTAAT_MAIN','BOTAAT_BOT_MENU','BOTAAT_ADD_NAME','BOTAAT_ADD_COOKIES','BOTAAT_EDIT_COOKIES','BOTAAT_RENAME','BOTAAT_DELETE_CONFIRM'].includes(s)) { await handleBotaatSession(api, event, adminSession); return true; }
    if (s === 'TABDEEL_SELECT')                                                       { await handleTabdeelSession(api, event, adminSession); return true; }
    if (s === 'HIMAYA_MAIN')                                                          { await handleHimayaSession(api, event, adminSession); return true; }
    if (['NEXUS_AI_MAIN','NEXUS_ADD_NAME','NEXUS_ADD_KEY','NEXUS_ADD_PROMPT','NEXUS_EDIT_SELECT','NEXUS_EDIT_PROMPT','NEXUS_DELETE_SELECT'].includes(s)) { await handleNexusAISession(api, event, adminSession); return true; }
    if (s === 'QAEEDA_MAIN' || s === 'QAEEDA_CONFIRM')                               { await handleQaeedaDBSession(api, event, adminSession); return true; }
    if (s === 'QAROBAAT_MAIN' || s === 'QAROBAAT_AWAIT_ID')                          { await handleQarobaatSession(api, event, adminSession); return true; }
    if (s === 'IDAFA_SELECT')                                                         { await handleIdafaSession(api, event, adminSession); return true; }
    if (s === 'BAYAAT_TARGET')        { await deleteAdminSession(senderID); await handleBayaat(api, event, text); return true; }
    if (s === 'BAYAAT_MOABAD_TARGET') { await deleteAdminSession(senderID); await handleBayaatMoabad(api, event, text); return true; }
    if (s === 'HADHF_TARGET')         { await deleteAdminSession(senderID); await handleHadhfAdmin(api, event, text); return true; }
  }

  // ── أوامر مباشرة ──────────────────────────────────────────────────
  if (text === 'ايدي') {
    const targetId = (event.messageReply && event.messageReply.senderID) ? String(event.messageReply.senderID) : String(senderID);
    const label = (event.messageReply && event.messageReply.senderID) ? 'ايدي الشخص' : 'ايدي';
    await sendMessage(api, `╮───∙⋆⋅「 ${label} 」\n│\n│ › ${targetId}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID);
    return true;
  }
  if (text === 'ايدي القروب') { await sendMessage(api, `╮───∙⋆⋅「 ايدي القروب 」\n│\n│ › ${event.threadID}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID); return true; }

  if (text === 'ادمن')            { await handleAdminMenu(api, event);         return true; }
  if (text === 'بيانات')          { await handleBayaanat(api, event);           return true; }
  if (text === 'تعديل')           { await handleTa3deel(api, event);            return true; }
  if (text === 'معلومات')         { await handleMa3loomat(api, event, '');      return true; }
  if (/^معلومات\s+(.+)$/.test(text)) { await handleMa3loomat(api, event, text.match(/^معلومات\s+(.+)$/)[1]); return true; }
  if (text === 'الحظر')           { await handleHazar(api, event);              return true; }
  if (text === 'اشعار')           { await handleIshaarAdmin(api, event);        return true; }
  if (text === 'تعطيل')           { await handleTatleel(api, event);            return true; }
  if (text === 'تشغيل')           { await handleTashgeel(api, event);           return true; }
  if (text === 'البوتات')         { await handleBotaat(api, event);             return true; }
  if (text === 'تبديل')           { await handleTabdeel(api, event);            return true; }
  if (text === 'اعادة ضبط')       { await handleEadatDabt(api, event);          return true; }
  if (text === 'الحماية')         { await handleHimaya(api, event);             return true; }
  if (text === 'ريست')            { await handleReset(api, event);              return true; }
  if (text === 'قاعدة البيانات')  { await handleQaeedaDB(api, event);           return true; }
  if (text === 'القروبات')        { await handleQarobaat(api, event);           return true; }
  if (text === 'الوكلاء')         { await handleNexusAI(api, event);            return true; }
  if (text === 'اضافة')           { await handleIdafa(api, event);              return true; }
  if (text === 'المشرفون')        { await handleMoshrefeen(api, event);         return true; }
  if (/^ادمن اضافة\s+(.+)$/.test(text)) { await handleAdminAdd(api, event, text.match(/^ادمن اضافة\s+(.+)$/)[1]); return true; }
  if (/^ادمن حذف\s+(.+)$/.test(text))   { await handleAdminRemove(api, event, text.match(/^ادمن حذف\s+(.+)$/)[1]); return true; }

  if (text === 'ذاكرة') { await handleZakira(api, event, ''); return true; }
  if (/^ذاكرة\s+(.+)$/.test(text)) { await handleZakira(api, event, text.match(/^ذاكرة\s+(.+)$/)[1].trim()); return true; }

  if (text === 'جاسوس') {
    const now = isSpyEnabled(); await setSpyEnabled(!now);
    await sendMessage(api, `╮───∙⋆⋅「 جاسوس 」\n│\n│ › ${!now ? '✅ تم تفعيل كشف الرسائل المحذوفة' : '🔴 تم تعطيل كشف الرسائل المحذوفة'}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID);
    return true;
  }

  if (text === 'مسح') {
    if (!event.messageReply || !event.messageReply.messageID) {
      await sendMessage(api, `╮───∙⋆⋅「 مسح 」\n│\n│ › رد على الرسالة التي تريد حذفها\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID); return true;
    }
    try { markBotDeleted(event.messageReply.messageID); await new Promise(r => api.unsendMessage(event.messageReply.messageID, () => r())); } catch (e) {}
    try {
      await new Promise(r => api.setMessageReaction('🗑️', event.messageID, event.threadID, () => r(), true));
      setTimeout(() => { try { api.setMessageReaction('', event.messageID, event.threadID, () => {}, true); } catch (e) {} }, 1000);
    } catch (e) {}
    return true;
  }

  if (text === 'بانكاي' || (event.messageReply && text === 'بانكاي')) { await handleBayaat(api, event, ''); return true; }
  if (/^بانكاي\s+(.+)$/.test(text)) { await handleBayaat(api, event, text.replace(/^بانكاي\s+/, '')); return true; }
  if (text === 'بانكاي مؤبد' || (event.messageReply && text === 'بانكاي مؤبد')) { await handleBayaatMoabad(api, event, ''); return true; }
  if (/^بانكاي مؤبد\s+(.+)$/.test(text)) { await handleBayaatMoabad(api, event, text.replace(/^بانكاي مؤبد\s+/, '')); return true; }
  if (text === 'طرد' || (event.messageReply && text === 'طرد')) { await handleBayaat(api, event, ''); return true; }
  if (/^طرد\s+(.+)$/.test(text)) { await handleBayaat(api, event, text.replace(/^طرد\s+/, '')); return true; }
  if (text === 'حذف' || (event.messageReply && text === 'حذف')) { await handleHadhfAdmin(api, event, ''); return true; }
  if (/^حذف\s+(.+)$/.test(text)) { const args = text.replace(/^حذف\s+/, ''); if (!/^.+\s+من\s+.+$/.test(args)) { await handleHadhfAdmin(api, event, args); return true; } }


  return false;
}

// ═════════════════════════════════════════════════════════════════════
//   الصادرات
// ═════════════════════════════════════════════════════════════════════

module.exports = {
  handleAdminGranted,
  handleAdminCommand,
  handleProtection,        // مُعاد تصدير من admin2.js
  handleDisabledCommand,
  matchCommandKey,
  isAdmin,
  kickFromAllGroups,
  getPermanentBan,
  initAdminIds,
  initGroupes,
  initBotEnabled,          // مُعاد تصدير من admin2.js
  isBotEnabled,            // مُعاد تصدير من admin2.js
};
