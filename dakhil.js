/*
 * ═══════════════════════════════════════════════════════════════════════
 *  dakhil.js — نظام كشف الدخلاء والترحيب بالوافدين الجدد للممالك
 * ═══════════════════════════════════════════════════════════════════════
 */

const { getPlayer, getPermanentBan } = require('./database');
const { getKingdomByThreadId, kingdomNamesAr, sendMessage, H } = require('./utils');
const config = require('./config.json');

async function getGroupAdmins(api, threadID) {
  return new Promise((resolve) => {
    try {
      api.getThreadInfo(threadID, (err, info) => {
        if (err || !info) return resolve([]);
        const admins = (info.adminIDs || []).map(a => String(a.id || a));
        resolve(admins);
      });
    } catch (e) {
      resolve([]);
    }
  });
}

async function getUserName(api, fbId) {
  return new Promise((resolve) => {
    try {
      api.getUserInfo([String(fbId)], (err, data) => {
        if (err || !data || !data[String(fbId)]) return resolve(null);
        resolve(data[String(fbId)].name || null);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function getFormattedDate() {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const y = now.getFullYear();
  return `${d}/${m}/${y}`;
}

function buildAlertMessage(intruderDisplay, intruderKingdom, adderDisplay) {
  let msg =
    `${H}¤   🚨┃⚠️ تـــنـــبـــيـــه ⚠️┃🚨   ¤\n` +
    `╮━━━━━━━━━━━━━━━━━━╭\n` +
    `    ⛔ تم رصد دخيل من مملكة اخرى\n \n` +
    `╞═════ ⋘ التقرير ⋙ ═════╡\n` +
    `✦ الدخيل ↜⟦ ${intruderDisplay} ⟧\n` +
    `✦ مملكته ↜⟦ ${intruderKingdom} ⟧\n`;
  if (adderDisplay) {
    msg += `✦ من اضافه ↜⟦ ${adderDisplay} ⟧\n`;
  }
  msg += `╯━━━━━━━━━━━━━━━━━━━╰`;
  return msg;
}

function buildWelcomeMessage(kingdom, userName, dateStr, adderName) {
  let headerDeco = '';
  if (kingdom === 'murdak') {
    headerDeco = `╗═━────༺☠༻────━═╔\n          ⌬ 𝙈𝙊𝙍𝘿𝘼𝙆 𝙆𝑰𝙉𝙂𝘿𝙊𝙈 ⌬\n╝═━────༺☠༻────━═╚`;
  } else if (kingdom === 'solfare') {
    headerDeco = `╗═━────༺☀༻────━═╔\n          ⌬ 𝙎𝙊𝙇𝙑𝘼𝙍𝘼 𝙆𝙄𝙉𝙂𝘿𝙊𝙈 ⌬\n╝═━────༺☀༻────━═╚`;
  } else if (kingdom === 'niravil') {
    headerDeco = `╗═━────༺✨༻────━═╔\n          ⌬ 𝙉𝙄𝙍𝘼𝙑𝙄𝙇 𝙆𝙄𝙉𝙂𝘿𝙊𝙈 ⌬\n╝═━────༺✨༻────━═╚`;
  } else {
    headerDeco = `╗═━────༺✨༻────━═╔\n          ⌬ ${kingdom.toUpperCase()} KINGDOM ⌬\n╝═━────༺✨༻────━═╚`;
  }

  return `${H}${headerDeco}\n` +
         `✧ 𓆩 تــــــــــــــرحــــــــــــــيــــــــــــــب 𓆪 ✧\n\n` +
         `؜╮∙⋆⋅「 ${userName} 」\n` +
         `│ › تاريخ الانضمام  ◄ ${dateStr}\n` +
         `│ › اضافه  ◄ ${adderName}\n` +
         `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
         `اهلا بك ايها المجند دخولك عالم نيكسوس ليس صدفة اكتب " تسجيل " ، ابدء مغامرتك وانقش اسمك على اعالي الامبراطورية \n` +
         `───────∙⋆⋅ ※ ⋅⋆∙───────\n` +
         `✦ للتسجيل في النضام اكتب " تسجيل "\n` +
         `✦ يمكنك سؤال المساعد الذكي عن اي شيئ بالنضام بكتابة " المساعد "\n` +
         `───────∙⋆⋅ ※ ⋅⋆∙───────`;
}

async function kickUser(api, fbId, threadID) {
  return new Promise((resolve) => {
    try {
      api.removeUserFromGroup(String(fbId), threadID, (err) => {
        resolve(!err);
      });
    } catch (e) {
      resolve(false);
    }
  });
}

// ===== كشف الدخيل والترحيب بالجدد عند الانضمام =====

async function handleIntruderJoin(api, event, botId) {
  const { threadID, author } = event;
  const groupKingdom = getKingdomByThreadId(threadID);
  if (!groupKingdom) return;

  const admins = await getGroupAdmins(api, threadID);

  // استخراج المضافين حديثاً فقط في هذا الحدث لتفادي تكرار الترحيب بالأعضاء القدامى
  let addedIDs = [];
  if (event.logMessageData && Array.isArray(event.logMessageData.addedParticipants)) {
    addedIDs = event.logMessageData.addedParticipants.map(p => String(p.userFbId || p.user_id));
  }

  for (const pidStr of addedIDs) {
    if (pidStr === String(botId)) continue;
    if (admins.includes(pidStr)) continue;

    const player = await getPlayer(pidStr);

    if (player) {
      // إذا كان مسجلاً بمملكة أخرى، فهو دخيل ويتم طرده
      if (player.kingdom !== groupKingdom) {
        const intruderDisplay = player.nickname;
        const intruderKingdom = kingdomNamesAr[player.kingdom] || player.kingdom;

        let adderDisplay = 'انضم بنفسه';
        const authorStr = author ? String(author) : null;

        if (authorStr && authorStr !== pidStr) {
          const fbName = await getUserName(api, authorStr);
          adderDisplay = fbName || authorStr;
        }

        await sendMessage(api, buildAlertMessage(intruderDisplay, intruderKingdom, adderDisplay), threadID);

        const kicked = await kickUser(api, pidStr, threadID);
        if (kicked) {
          await sendMessage(api, `${H}تم طرد الدخيل بنجاح ✅️`, threadID);
        }
      }
    } else {
      // العضو غير مسجل في النظام بعد
      const ban = await getPermanentBan(pidStr);
      if (ban) continue; // العضو محظور بشكل دائم، سيتم طرده تلقائياً من index.js

      const userName = await getUserName(api, pidStr) || 'عضو جديد';
      const formattedDate = getFormattedDate();

      let adderDisplay = 'انضم بنفسه';
      const authorStr = author ? String(author) : null;

      if (authorStr && authorStr !== pidStr) {
        // جلب اسم حساب المضيف الفعلي على فيسبوك مباشرة وليس لقبه بالنظام
        const fbName = await getUserName(api, authorStr);
        adderDisplay = fbName || authorStr;
      }

      // إرسال رسالة الترحيب المخصصة للوافد الجديد
      const welcomeMsg = buildWelcomeMessage(groupKingdom, userName, formattedDate, adderDisplay);
      await sendMessage(api, welcomeMsg, threadID);
    }
  }
}

// ===== كشف الدخيل عبر الرسائل =====

async function handleIntruderMessage(api, event, player, groupKingdom) {
  const { threadID, senderID } = event;

  if (player.kingdom === groupKingdom) return false;

  const admins = await getGroupAdmins(api, threadID);
  if (admins.includes(String(senderID))) return false;

  const intruderDisplay = player.nickname;
  const intruderKingdom = kingdomNamesAr[player.kingdom] || player.kingdom;

  await sendMessage(api, buildAlertMessage(intruderDisplay, intruderKingdom, null), threadID);

  const kicked = await kickUser(api, String(senderID), threadID);
  if (kicked) {
    await sendMessage(api, `${H}تم طرد الدخيل بنجاح ✅️`, threadID);
  }

  return true;
}

module.exports = { handleIntruderJoin, handleIntruderMessage };