/*
 * ═══════════════════════════════════════════════════════════════════════
 *  tasjil.js — نظام التسجيل والانضمام
 * ═══════════════════════════════════════════════════════════════════════
 */

const {
  getPlayer,
  getPlayerByNickname,
  createPlayer,
  updatePlayer,
  getTempSession,
  setTempSession,
  deleteTempSession,
  getNextClass,
  addNotification,
  getJoinSession,
  setJoinSession,
  deleteJoinSession
} = require('./database');

const {
  sendReply,
  sendMessage,
  getKingdomByThreadId,
  kingdomNames,
  kingdomNamesAr,
  classSymbols,
  generateNickname,
  extractFbId,
  extractUsername
} = require('./utils');

const { changePlayerNickname } = require('./dukhul');
const config = require('./config.json');

// مراحل التسجيل
const STEPS = {
  NICKNAME: 'nickname',
  CONFIRM: 'confirm',
  SYSTEM_GROUP: 'system_group',
  INVITE: 'invite',
  KINGDOM_CHOICE: 'kingdom_choice'
};

async function handleTasjil(api, event) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();
  const kingdom = getKingdomByThreadId(threadID);
  if (!kingdom) return;

  // تحقق إذا اللاعب مسجل مسبقا
  const existing = await getPlayer(senderID);
  if (existing) {
    await sendReply(api,
      `𓆫─━━࿇━━━──━━━࿇━━─𓆫\n              『 تنبيه ⚠ 』\n\nأنت مسجل مسبقاً في نظام نيكسوس باللقب 『${existing.nickname}』\n\n     𓆫─━━࿇━━━──━━━࿇━━─𓆫`,
      messageID, threadID);
    return;
  }

  const session = await getTempSession(senderID);

  // بداية التسجيل
  if (!session || text === 'تسجيل') {
    await setTempSession(senderID, {
      step: STEPS.NICKNAME,
      kingdom,
      threadID
    });
    await sendReply(api, buildStep1(), messageID, threadID);
    return;
  }

  // معالجة مراحل التسجيل
  if (session.step === STEPS.NICKNAME) {
    await handleNicknameStep(api, event, session, text);
  } else if (session.step === STEPS.CONFIRM) {
    await handleConfirmStep(api, event, session, text);
  } else if (session.step === STEPS.SYSTEM_GROUP) {
    await handleSystemGroupStep(api, event, session, text);
  } else if (session.step === STEPS.INVITE) {
    await handleInviteStep(api, event, session, text);
  } else if (session.step === STEPS.KINGDOM_CHOICE) {
    await handleKingdomChoiceStep(api, event, session, text);
  }
}

// ===== المرحلة 1: اللقب =====
async function handleNicknameStep(api, event, session, text) {
  const { threadID, senderID, messageID } = event;

  // التحقق من اللقب
  let error = null;
  if (text.length < 3) {
    error = 'يجب ان يكون اللقب اكثر من 3 احرف .....';
  } else if (text.length > 40) {
    error = 'يجب ان يكون اللقب اقل من 40 حرفا ....';
  } else if (!text.replace(/\s/g, '').length) {
    error = 'يجب الا يكون اللقب عبارة عن فراغات ...';
  } else {
    const taken = await getPlayerByNickname(text);
    if (taken) error = 'هذا اللقب تم استخدامه بالفعل ....';
  }

  if (error) {
    await sendReply(api, buildNicknameError(error), messageID, threadID);
    return;
  }

  // لقب صحيح
  await setTempSession(senderID, { ...session, step: STEPS.CONFIRM, pendingNickname: text });
  await sendReply(api, buildConfirmMsg(text), messageID, threadID);
}

// ===== المرحلة 2: تأكيد اللقب =====
async function handleConfirmStep(api, event, session, text) {
  const { threadID, senderID, messageID } = event;

  if (text === 'تعديل' || text === 'تسجيل') {
    await setTempSession(senderID, { ...session, step: STEPS.NICKNAME, pendingNickname: null });
    await sendReply(api, buildStep1(), messageID, threadID);
    return;
  }

  if (text === 'نعم') {
    await setTempSession(senderID, { ...session, step: STEPS.SYSTEM_GROUP });
    await sendReply(api, buildSystemGroupMsg(), messageID, threadID);
    return;
  }

  // لم يفهم
  await sendReply(api, `❖ ارسل 《 نعم 》للمواصلة او 《 تعديل 》لتغيير اللقب`, messageID, threadID);
}

// ===== المرحلة 3: قروب النظام =====
async function handleSystemGroupStep(api, event, session, text) {
  const { threadID, senderID, messageID } = event;

  if (text === 'تم') {
    await setTempSession(senderID, { ...session, step: STEPS.INVITE });
    await sendReply(api, buildInviteMsg(), messageID, threadID);
  }
}

// ===== المرحلة 4: الدعوة =====
async function handleInviteStep(api, event, session, text) {
  const { threadID, senderID, messageID } = event;

  if (text === 'تخطي') {
    await finalizeRegistration(api, event, session, null);
    return;
  }

  // محاولة استخراج الايدي
  let inviterPlayer = null;
  const fbId = extractFbId(text);

  if (fbId) {
    inviterPlayer = await getPlayer(fbId);
  }

  if (!inviterPlayer) {
    // محاولة بالبحث عن لقب
    inviterPlayer = await getPlayerByNickname(text);
  }

  if (!inviterPlayer) {
    await sendReply(api, buildInviteError(), messageID, threadID);
    return;
  }

  // تحقق إذا الداعي من مملكة أخرى
  if (inviterPlayer.kingdom !== session.kingdom) {
    await setTempSession(senderID, {
      ...session,
      step: STEPS.KINGDOM_CHOICE,
      inviterFbId: inviterPlayer.fbId,
      inviterKingdom: inviterPlayer.kingdom
    });
    await sendReply(api, buildKingdomChoiceMsg(inviterPlayer.kingdom, session.kingdom), messageID, threadID);
    return;
  }

  // من نفس المملكة
  await finalizeRegistration(api, event, session, inviterPlayer.fbId);
}

// ===== المرحلة 5: اختيار المملكة =====
async function handleKingdomChoiceStep(api, event, session, text) {
  const { threadID, senderID, messageID } = event;

  if (text === 'مواصلة') {
    await finalizeRegistration(api, event, session, session.inviterFbId);
    return;
  }

  if (text === 'نقل') {
    const targetKingdom = session.inviterKingdom;
    const targetGroupId = config.groupes[targetKingdom];

    await sendReply(api,
      `⚠️ ━━━━━━━━━━━━━━━━ ⚠️\n┇سيتم نقلك لمملكة ${kingdomNamesAr[targetKingdom]} بعد 5 ثواني\n\n┇اذا لم تجد قروب المملكة الجديدة جرب البحث في طلبات المراسلة \n⚠️ ━━━━━━━━━━━━━━━━ ⚠️`,
      messageID, threadID);

    // انتظر 5 ثواني
    setTimeout(async () => {
      try {
        // طرد اللاعب من المجموعة الحالية
        await removeFromGroup(api, senderID, threadID);

        // إضافة اللاعب للمجموعة الجديدة
        await addToGroup(api, senderID, targetGroupId);

        // الحصول على اسم المستخدم
        const userInfo = await getUserInfo(api, senderID);
        const userName = userInfo ? userInfo.name : String(senderID);

        await sendMessage(api,
          `⟬ ${userName} ⟭\n✦ تمت عملية النقل بنجاح`,
          targetGroupId);

        // إتمام التسجيل في المملكة الجديدة
        await finalizeRegistration(api, event, { ...session, kingdom: targetKingdom, threadID: targetGroupId }, session.inviterFbId, true);

      } catch (err) {
        console.error('خطأ في النقل:', err);
        await sendMessage(api,
          `حصل خطأ يرجى التواصل مع الادمن`,
          threadID);
      }
    }, 5000);

    return;
  }

  await sendReply(api,
    `❖ ارسل 《 مواصلة 》للبقاء في مملكتك او 《 نقل 》للانتقال`,
    messageID, threadID);
}

// ===== إتمام التسجيل =====
async function finalizeRegistration(api, event, session, inviterFbId, transferred = false) {
  const { threadID, senderID, messageID } = event;
  const targetThreadID = session.threadID || threadID;

  const playerClass = await getNextClass(session.kingdom);
  const symbol = classSymbols[playerClass];
  const rank = 'مجند';

  const playerData = {
    fbId: String(senderID),
    nickname: session.pendingNickname,
    kingdom: session.kingdom,
    class: playerClass,
    rank,
    coins: 0,
    level: 1,
    hp: 1000,
    ep: 1000,
    invitedBy: inviterFbId || null,
    registeredAt: new Date()
  };

  await createPlayer(playerData);
  await deleteTempSession(senderID);

  // تغيير كنية اللاعب في كل القروبات المملكة
  const groupId = config.groupes[session.kingdom];
  try {
    await changePlayerNickname(api, groupId, senderID, session.pendingNickname, rank, playerClass);
  } catch (e) {
    console.error('خطأ في تغيير كنية اللاعب:', e);
  }

  // إرسال رسالة التسجيل الناجح
  const successMsg = buildSuccessMsg(session.pendingNickname, session.kingdom, playerClass);
  if (transferred) {
    await sendMessage(api, successMsg, targetThreadID);
  } else {
    await sendReply(api, successMsg, messageID, targetThreadID);
  }

  // إشعار الداعي إذا وجد
  if (inviterFbId) {
    const inviter = await getPlayer(inviterFbId);
    if (inviter) {
      // إضافة 50 كوينز للداعي
      await updatePlayer(inviterFbId, { coins: (inviter.coins || 0) + 50 });
      // إضافة إشعار
      await addNotification(inviterFbId,
        `⦿ انضم اللاعب 〘 ${session.pendingNickname} 〙بفضلك الى عالم نيكسوس \nحصلت على مكافئة ⛁ ◀ 50 كوينز`
      );

      // ── تسجيل نقطة دعوة جديدة في مسابقة الدعوات الحالية ──
      try {
        const { recordDa3wa } = require('./Mosaba9at');
        await recordDa3wa(inviterFbId, inviter.nickname || String(inviterFbId));
      } catch (compErr) {
        console.error('[Competition] خطأ في تسجيل الدعوة بالمسابقة:', compErr);
      }
    }
  }
}

// ===== رسائل المراحل =====

function buildStep1() {
  return `╗═════━━━❖━━━═════╔
 ⊱          بٖــــوٖاٖبٖةٖ نٖــــيٖكٖسٖــــوٖسٖ        ⊰  
╝═════━━━❖━━━═════╚

     𓆫─━━࿇━━━──━━━࿇━━─𓆫
              『مرحلة التسجيل ⛨ 』

اهلا بك في عالم نيكسوس من فضلك اكتب اللقب الذي تود استعماله في النظام 

     𓆫─━━࿇━━━──━━━࿇━━─𓆫`;
}

function buildNicknameError(reason) {
  return `𓆫─━━࿇━━━──━━━࿇━━─𓆫
              『لقب غير مناسب ⚠ 』

${reason}

❖ اعد ارسال لقبك 

     𓆫─━━࿇━━━──━━━࿇━━─𓆫`;
}

function buildConfirmMsg(nickname) {
  return `╗═════━━━❖━━━═════╔
 ⊱          بٖــــوٖاٖبٖةٖ نٖــــيٖكٖسٖــــوٖسٖ        ⊰  
╝═════━━━❖━━━═════╚

     𓆫─━━࿇━━━──━━━࿇━━─𓆫
              『 تأكيد اللقب ⊹ 』

هل انت متأكد من استعمال هذا اللقب『${nickname}』

✎ لتعديله ارسل 《 تعديل 》
⎋ للمواصلة ارسل 《 نعم 》


     𓆫─━━࿇━━━──━━━࿇━━─𓆫`;
}

function buildSystemGroupMsg() {
  return `╗═════━━━❖━━━═════╔
 ⊱          بٖــــوٖاٖبٖةٖ نٖــــيٖكٖسٖــــوٖسٖ        ⊰  
╝═════━━━❖━━━═════╚

     𓆫─━━࿇━━━──━━━࿇━━─𓆫
              『 قروب النضام 𖠿 』

✦ قم بالانضمام الى المجموعة الرسمية لنضام نيكسوس ⚐
✦ بعد الانضمام ارسل 《 تم 》

https://facebook.com/groups/1970196400432434/


     𓆫─━━࿇━━━──━━━࿇━━─𓆫`;
}

function buildInviteMsg() {
  return `     𓆫─━━࿇━━━──━━━࿇━━─𓆫
              『 الدعوة ✉ 』

✦ في حالة دعاك شخص ما للنضام رجائا ارسل لقبه او رابط حسابه ليحصل على مكافئة 

✦ لتخطي هذه المرحلة ارسل 《 تخطي 》


     𓆫─━━࿇━━━──━━━࿇━━─𓆫`;
}

function buildInviteError() {
  return `𓆫─━━࿇━━━──━━━࿇━━─𓆫
              『 خطأ ⚠ 』

✦ لم يتم العثور على هذا اللاعب في نضام نيكسوس رجائا ارسل لقبا او رابطا صحيحا 

✦ لتخطي هذه المرحلة ارسل 《 تخطي 》


     𓆫─━━࿇━━━──━━━࿇━━─𓆫`;
}

function buildKingdomChoiceMsg(inviterKingdom, currentKingdom) {
  return `𓆫─━━࿇━━━──━━━࿇━━─𓆫 
✦ اللاعب الذي دعاك كان من مملكة ${kingdomNamesAr[inviterKingdom]} 
✦ اتود الاستمرار في هذه المملكة او الانتقال الى مملكة ${kingdomNamesAr[inviterKingdom]}
❖ للمواصلة هنا ارسل 《مواصلة 》
❖ للانتقال الى ${kingdomNamesAr[inviterKingdom]} ارسل 《نقل 》
𓆫─━━࿇━━━──━━━࿇━━─𓆫`;
}

function buildSuccessMsg(nickname, kingdom, playerClass) {
  const symbol = classSymbols[playerClass];
  return `𒂭━══════════════━𒂭
          『 تم التسجيل بنجاح 』      
    
⌑ اللقب     ⍇\u200B⫸  ${nickname}
⌑ المملكة   ⍇⫸ ${kingdomNamesAr[kingdom]}

   قام نضام نيكسوس بتحديد فئتك
  ▱▰▱▰▱▰▱▰▱▰▱▰
       تم تصنيفك ك : ${playerClass} ${symbol}
  ▱▰▱▰▱▰▱▰▱▰▱▰
اكتب 《الاوامر 》لعرض اوامر التحكم بالبوت 
𒂭━══════════════━𒂭`;
}

// مساعدات
function removeFromGroup(api, userId, threadID) {
  return new Promise((resolve, reject) => {
    api.removeUserFromGroup(userId, threadID, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// إضافة للمجموعة
function addToGroup(api, userId, threadID) {
  return new Promise((resolve, reject) => {
    api.addUserToGroup(userId, threadID, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function getUserInfo(api, userId) {
  return new Promise((resolve) => {
    api.getUserInfo(userId, (err, info) => {
      if (err || !info) return resolve(null);
      resolve(info[userId] || null);
    });
  });
}

// ===== دوال الانضمام من القروبات الخارجية =====

// تحديد المملكة من النص (رقم أو اسم)
function resolveKingdom(text) {
  const t = text.trim();
  if (t === '1' || t === 'مورداك') return 'murdak';
  if (t === '2' || t === 'سولفارا') return 'solfare';
  if (t === '3' || t === 'نيرافيل') return 'niravil';
  return null;
}

// تفاعل مع رسالة
function reactToMessage(api, messageID, emoji) {
  return new Promise((resolve) => {
    api.setMessageReaction(emoji, messageID, () => resolve(), true);
  });
}

// رسالة اختيار المملكة
function buildKingdomJoinMsg() {
  return `╮──∙⋆⋅「 انضم الى عالم نيكسوس 」\n│\n│› اذا كنت تريد دخول عالم صراع الممالك نيكسوس رد على هذه الرسالة برقم المملكة او اسمها !\n│ ✧ 1 / مورداك \n│ ✧ 2 / سولفارا\n│ ✧ 3 / نيرافيل\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
}

// رسالة "جاري الإضافة"
function buildJoiningMsg(kingdom) {
  return `╮───∙⋆⋅「 جاري المعالجة ⏳ 」\n│\n│ › يجري الآن إضافتك إلى مملكة ${kingdomNamesAr[kingdom]}\n│ › تفضل بالانتظار لحظة ...\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
}

// رسالة الترحيب في قروب المملكة
function buildJoinedMsg(kingdom) {
  return `╮──∙⋆⋅「 مرحباً بك في نيكسوس ✨ 」\n│\n│ › دخلت لعالم نيكسوس\n│ › المملكة الحالية : ${kingdomNamesAr[kingdom]}\n│\n│ › اكتب 《 تسجيل 》 لإنشاء حسابك\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
}

// رسالة الخاص (DM)
function buildDMMsg(kingdom) {
  return `╮──∙⋆⋅「 نيكسوس — طلب انضمام 」\n│\n│ › مرحباً ! طلبت الانضمام لمملكة ${kingdomNamesAr[kingdom]}\n│\n│ › رد على هذه الرسالة بأي نص\n│ › لتتم إضافتك في قروب المملكة\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
}

// ===== معالجة "تسجيل" في قروب خارجي =====
async function handleExternalJoin(api, event) {
  const { threadID, senderID, messageID } = event;

  // تحقق أنه مسجل مسبقاً
  const existing = await getPlayer(senderID);
  if (existing) {
    await sendReply(api,
      `𓆫─━━࿇━━━──━━━࿇━━─𓆫\n              『 تنبيه ⚠ 』\n\nأنت مسجل مسبقاً في نظام نيكسوس باللقب 『${existing.nickname}』\n\n     𓆫─━━࿇━━━──━━━࿇━━─𓆫`,
      messageID, threadID);
    return;
  }

  // رسالة التنبيه
  await sendReply(api,
    `╮───∙⋆⋅「 تنبيه 」\n│\n│ › التسجيل متاح فقط في قروبات الممالك\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    messageID, threadID);

  // رسالة اختيار المملكة
  const info = await sendMessage(api, buildKingdomJoinMsg(), threadID);
  const joinMsgId = info ? info.messageID : null;

  await setJoinSession(senderID, {
    step: 'CHOOSE_KINGDOM',
    externalThreadId: String(threadID),
    joinMsgId
  });
}

// ===== معالجة رد اختيار المملكة =====
async function handleExternalJoinReply(api, event) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();

  const session = await getJoinSession(senderID);
  if (!session || session.step !== 'CHOOSE_KINGDOM') return false;

  // تحديد المملكة
  const kingdom = resolveKingdom(text);
  if (!kingdom) {
    await sendReply(api,
      `╮───∙⋆⋅「 خطأ 」\n│ › الرجاء إرسال رقم المملكة أو اسمها\n│ ✧ 1 / مورداك\n│ ✧ 2 / سولفارا\n│ ✧ 3 / نيرافيل\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
    return true;
  }

  // تفاعل ⏳
  await reactToMessage(api, messageID, '⏳');

  const targetGroupId = String(config.groupes[kingdom]);

  // رسالة "جاري الإضافة"
  await sendReply(api, buildJoiningMsg(kingdom), messageID, threadID);

  // محاولة الإضافة المباشرة
  try {
    await addToGroup(api, senderID, targetGroupId);
    // نجحت → تفاعل ✅️ + رسالة الترحيب في قروب المملكة
    await reactToMessage(api, messageID, '✅');
    await sendMessage(api, buildJoinedMsg(kingdom), targetGroupId);
    await deleteJoinSession(senderID);
  } catch (e) {
    // فشل (البوت ليس أدمن) → إرسال DM
    await setJoinSession(senderID, {
      ...session,
      step: 'WAITING_DM',
      kingdom,
      targetGroupId,
      externalMsgId: messageID,
      externalThreadId: String(threadID)
    });

    try {
      await sendMessage(api, buildDMMsg(kingdom), senderID);
    } catch (dmErr) {
      console.error('خطأ في إرسال DM:', dmErr);
    }

    await sendReply(api,
      `╮───∙⋆⋅「 تنبيه 」\n│\n│ › تم إرسال رسالة لك في الخاص\n│ › رد عليها لإضافتك في قروب المملكة\n│ › والدخول لعالم نيكسوس ✨\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
  }

  return true;
}

// ===== معالجة الرد في الخاص =====
async function handleDMJoin(api, event) {
  const { senderID, messageID } = event;

  const session = await getJoinSession(senderID);
  if (!session || session.step !== 'WAITING_DM') return false;

  const { kingdom, targetGroupId, externalMsgId, externalThreadId } = session;

  try {
    await addToGroup(api, senderID, targetGroupId);

    // تفاعل ✅️ على الرسالة الأصلية في القروب الخارجي
    if (externalMsgId) {
      await reactToMessage(api, externalMsgId, '✅').catch(() => {});
    }

    // ترحيب في قروب المملكة
    await sendMessage(api, buildJoinedMsg(kingdom), targetGroupId);

    // رد في الخاص
    await sendMessage(api,
      `╮──∙⋆⋅「 تم ✅ 」\n│\n│ › تمت إضافتك إلى عالم نيكسوس\n│ › المملكة الحالية : ${kingdomNamesAr[kingdom]}\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      senderID);

    await deleteJoinSession(senderID);
  } catch (e) {
    console.error('خطأ في إضافة اللاعب من DM:', e);
    await sendMessage(api,
      `╮───∙⋆⋅「 خطأ 」\n│\n│ › حصل خطأ يرجى التواصل مع الأدمن\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      senderID);
  }

  return true;
}

module.exports = { handleTasjil, handleExternalJoin, handleExternalJoinReply, handleDMJoin };