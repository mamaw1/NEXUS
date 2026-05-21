/*
 * ═══════════════════════════════════════════════════════════════════════
 *  dar_alal3ab.js — نظام دار الألعاب المتكامل لبوت نيكسوس
 * ═══════════════════════════════════════════════════════════════════════
 */

'use strict';

const { getDB, getPlayer, updatePlayer, addNotification } = require('./database');
const { sendReply, sendMessage, H, kingdomNamesAr, extractFbId } = require('./utils');
const config = require('./config.json');

// مفتاح Groq للأسئلة الثقافية والدينية
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// قائمة الألعاب المتاحة وأسمائها ووصفها
const GAMES = {
  1: { key: 'xo', name: 'اكس أو', desc: 'لعبة الذكاء والتخطيط الكلاسيكية. اكس ❌ وأو 🟢.\nالفوز في الفردي يمنحك 2 كوينز.' },
  2: { key: 'guess', name: 'تخمين الرقم', desc: 'خمن الرقم السري بين 1 و 100.\nالفردي: لديك 30 ثانية للتخمين مع تلميحات.\nالفوز يكون بالتخمين الصحيح أو القريب بـ 3 درجات.' },
  5: { key: 'word_assemble', name: 'تجميع الكلمات', desc: 'قم بتجميع الحروف المبعثرة لتكوين كلمة صحيحة من عالم نيكسوس.' },
  6: { key: 'word_disassemble', name: 'تفكيك الكلمات', desc: 'قم بتفكيك الكلمة المعطاة إلى حروف مفرقة بمسافات بينها.' },
  7: { key: 'guess_flag', name: 'احزر البلد من العلم', desc: 'أرسل اسم البلد الصحيح المطابق لإيموجي العلم المعروض.' },
  8: { key: 'bomb', name: 'خيوط القنبلة', desc: 'قنبلة بـ 10 خيوط ملونة. خيط واحد عشوائي يفجر القنبلة.\nاقطع الخيوط بالتناوب، ومن ينفجر عنده يخسر.' },
  10: { key: 'hide_seek', name: 'الغميضة', desc: 'البوت أو الخصم يختبئ في صندوق من 10 صناديق.\nالفردي: لديك 5 محاولات لإيجاده.\nالتحدي: لا يمكن لعبها في نفس المملكة لحفظ السرية.' },
  11: { key: 'pinata', name: 'ضرب البنياتا', desc: 'اضرب البنياتا بالتناوب بقوة ضرب عشوائية (3% - 12%).\nالبنياتا قوتها 100%، ومن يكسرها يربح.' },
  12: { key: 'cards', name: 'البطاقات', desc: 'لكل لاعب 5 بطاقات عشوائية (1-10).\n5 جولات، في كل جولة يحدد البوت عشوائياً الفوز للأكبر أو الأصغر.' },
  13: { key: 'intruder', name: 'الدخيل', desc: 'مجموعة من 31 إيموجي تحتوي على 15 زوجاً متطابقاً وإيموجي واحد دخيل.\nجد الإيموجي الدخيل الفريد للفوز.' },
  14: { key: 'tug_of_war', name: 'شد الحبل', desc: 'لعبة جماعية تفاعلية في نفس المملكة فقط.\nمن يجمع "شدات" أكثر من أصدقائه خلال 30 ثانية يفوز.' }
};

// إيموجيات خيوط القنبلة
const BOMB_WIRES = ['🔴', '🔵', '🟢', '🟡', '⚫', '⚪', '🟤', '🟣', '🟠', '🟨'];

// إيموجيات أعلام الدول والبلدان المطابقة
const FLAG_DB = [
  { flag: '🇲🇦', ans: 'المغرب' }, { flag: '🇩🇿', ans: 'الجزائر' }, { flag: '🇸🇦', ans: 'السعودية' },
  { flag: '🇪🇬', ans: 'مصر' }, { flag: '🇵🇸', ans: 'فلسطين' }, { flag: '🇮🇶', ans: 'العراق' },
  { flag: '🇸🇾', ans: 'سوريا' }, { flag: '🇹🇳', ans: 'تونس' }, { flag: '🇯🇴', ans: 'الأردن' },
  { flag: '🇦🇪', ans: 'الإمارات' }, { flag: '🇶🇦', ans: 'قطر' }, { flag: '🇴🇲', ans: 'عمان' },
  { flag: '🇾🇪', ans: 'اليمن' }, { flag: '🇱🇧', ans: 'لبنان' }, { flag: '🇰🇼', ans: 'الكويت' },
  { flag: '🇧🇭', ans: 'البحرين' }, { flag: '🇸🇩', ans: 'السودان' }, { flag: '🇱🇾', ans: 'ليبيا' }
];

// كلمات عالم نيكسوس للألعاب اللغوية
const NEXUS_WORDS = ['نيكسوس', 'مورداك', 'سولفارا', 'نيرافيل', 'فارس', 'ساحر', 'معالج', 'مجند', 'كوينز', 'مملكة'];

// إيموجيات للعبة الدخيل
const INTRUDER_EMOJIS = ['🦊', '🐯', '🍎', '🐶', '🎯', '🌸', '🚀', '🦋', '🐱', '🐼', '🍕', '🎸', '🌈', '🐮', '🦁', '🐸', '🐨', '🦖', '🍩', '🥑', '🛸', '🎈', '🔑', '💎', '🎨', '🎪', '⚽', '🚗', '👻', '🌵', '🌽'];

// استدعاء محرك الذكاء الاصطناعي Groq
async function generateAIGameQuestion(category) {
  if (!GROQ_API_KEY) throw new Error('NO_KEY');
  const systemPrompt = category === 'religious' 
    ? 'أنت مسؤول عن توليد سؤال إسلامي ديني قصير وسهل مع إجابته النموذجية المباشرة والمختصرة باللغة العربية لعالم الألعاب.' 
    : 'أنت مسؤول عن توليد سؤال ثقافي عام شيق وسهل مع إجابته النموذجية المباشرة والمختصرة باللغة العربية لعالم الألعاب.';
  
  const prompt = `${systemPrompt}\nأرسل السؤال والإجابة فقط بالصيغة التالية تماماً دون أي ثرثرة إضافية:\nالسؤال: [نص السؤال هنا]\nالإجابة: [الإجابة النموذجية المختصرة هنا]`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama3-8b-8192',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5
    })
  });

  if (!res.ok) throw new Error('Groq Error');
  const data = await res.json();
  const text = data.choices[0].message.content.trim();
  
  const qMatch = text.match(/السؤال:\s*(.+)/i);
  const aMatch = text.match(/الإجابة:\s*(.+)/i);

  if (!qMatch || !aMatch) throw new Error('Parse Error');
  return { question: qMatch[1].trim(), answer: aMatch[1].trim() };
}

async function verifyAIResponse(question, correctAnswer, userAnswer) {
  // أولاً: مطابقة نصية مباشرة سريعة لتوفير وقت الاستجابة
  const normalize = (s) => s.trim().replace(/\s+/g, ' ').replace(/[،,\.。؟?!]/g, '').toLowerCase();
  const normUser = normalize(userAnswer);
  const normCorrect = normalize(correctAnswer);
  if (normUser === normCorrect || normCorrect.includes(normUser) || normUser.includes(normCorrect)) {
    return true;
  }

  // ثانياً: التحقق الدلالي الذكي عبر Groq لمعالجة الصياغات المختلفة
  if (!GROQ_API_KEY) return false;

  const systemPrompt = `أنت محكّم ذكي لألعاب الأسئلة والمعلومات العامة باللغة العربية.
مهمتك الوحيدة: تحديد إذا كانت إجابة اللاعب صحيحة أم لا، مع الأخذ بعين الاعتبار:
- الاختلافات في الصياغة (مثلاً "مكة" و"مكة المكرمة" كلاهما صحيح)
- الاختصارات المقبولة (مثلاً "السعودية" بدل "المملكة العربية السعودية")
- الأخطاء الإملائية البسيطة التي لا تغير المعنى
- الترجمات المختلفة للأسماء الأجنبية
- المعنى العام وليس التطابق الحرفي
رد بكلمة واحدة فقط: "نعم" إذا كانت الإجابة صحيحة، أو "لا" إذا كانت خاطئة. لا تضف أي شرح.`;

  const userPrompt = `السؤال: ${question}
الإجابة النموذجية: ${correctAnswer}
إجابة اللاعب: ${userAnswer}
هل إجابة اللاعب صحيحة؟`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.0,
        max_tokens: 5
      })
    });
    if (!res.ok) return false;
    const data = await res.json();
    const verdict = data.choices[0].message.content.trim();
    return verdict.includes('نعم');
  } catch {
    return false;
  }
}

// ===== القائمة الرئيسية لدار الألعاب =====
async function handleDarAlal3abMenu(api, event) {
  const { threadID, senderID, messageID } = event;
  const player = await getPlayer(senderID);
  if (!player) return;

  const db = getDB();
  await db.collection('dar_alal3ab_sessions').updateOne(
    { fbId: String(senderID) },
    { $set: { step: 'MENU', updatedAt: new Date() } },
    { upsert: true }
  );

  const menuMsg = 
    `⋇⋆✦⋆⋇───────────⋇⋆✦⋆⋇\n` +
    `⟦ 👾 ⟧ دار الالعــــــــــــــــــــاب ⟦ 👾 ⟧\n` +
    `⋇⋆✦⋆⋇───────────⋇⋆✦⋆⋇\n\n` +
    `『 1 』   「 اكس أو 」\n` +
    `『 2 』   「 تخمين الرقم」\n` +

    `『 5 』   「 تجميع الكلمات 」\n` +
    `『 6 』   「 تفكيك الكلمات 」\n` +
    `『 7 』   「 احزر البلد من العلم  」\n` +
    `『 8 』   「 خيوط القنبلة 」\n` +
    `『 10 』 「 الغميضة 」\n` +
    `『 11 』 「 ضرب البنياتا 」\n` +
    `『 12 』 「 البطاقات 」\n` +
    `『 13 』 「 الدخيل 」\n` +
    `『 14 』 「 شد الحبل 」\n` +
    `⋇⋆✦⋆⋇───────────⋇⋆✦⋆⋇\n` +
    `                『 0 』      ⟦ خروج ⟧\n` +
    `⋇⋆✦⋆⋇───────────⋇⋆✦⋆⋇`;

  await sendReply(api, menuMsg, messageID, threadID);
}

// ===== معالجة تفاعلات دار الألعاب بالكامل =====
async function handleDarAlal3abSession(api, event, session) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();
  const db = getDB();

  // خيار الخروج العام من جلسات الاختيار (لا يُطبّق على مرحلة تحديد الرهان لأن 0 تعني "بدون رهان")
  if ((text === '0' || text === 'خروج') && session.step !== 'CHALLENGE_BET') {
    await db.collection('dar_alal3ab_sessions').deleteOne({ fbId: String(senderID) });
    await sendReply(api, `${H}🚪 تم الخروج من دار الألعاب. طاب يومك!`, messageID, threadID);
    return true;
  }

  // 1. القائمة الرئيسية واختيار اللعبة
  if (session.step === 'MENU') {
    const num = parseInt(text, 10);
    if (isNaN(num) || !GAMES[num]) {
      await sendReply(api, `${H}⚠️ يرجى إرسال رقم لعبة صحيح من القائمة أو 0 للخروج.`, messageID, threadID);
      return true;
    }

    const game = GAMES[num];


    // الانتقال للوبي اللعبة المحددة
    await db.collection('dar_alal3ab_sessions').updateOne(
      { fbId: String(senderID) },
      { $set: { step: 'LOBBY', gameKey: game.key, gameName: game.name } }
    );

    const lobbyMsg = 
      `╮━─━─━─≪👾≫─━─━─━╭\n` +
      `               ✧ ${game.name} ✧               \n` +
      `╯━─━─━─≪👾≫─━─━─━╰\n\n` +
      `─────؜「 وصف اللعبة 」──────\n` +
      `${game.desc}\n` +
      `─────────────────────\n` +
      `⌬ 1 الوضع الفردي \n` +
      `⌬ 2 وضع تحدي لاعب اخر \n` +
      `⌬ 0 الخروج من اللعبة \n` +
      `────────────────────\n` +
      `     🎮 للبدء ارسل رقم الوضع 🎮\n` +
      `────────────────────`;

    await sendReply(api, lobbyMsg, messageID, threadID);
    return true;
  }

  // 2. معالجة خيار وضع اللعب داخل اللوبي
  if (session.step === 'LOBBY') {
    if (text === '1') {
      // بدء الوضع الفردي مباشرة
      await startSinglePlayerGame(api, event, session);
      return true;
    } else if (text === '2') {
      // التحقق من أن اللعبة تدعم التحدي الفردي (شد الحبل لا يدعم الفردي أو التحدي المباشر بنفس الطريقة)
      if (session.gameKey === 'tug_of_war') {
        await startTugOfWarChallenge(api, event, session);
        return true;
      }
      // الانتقال لمرحلة تحديد الرهان للتحدي
      await db.collection('dar_alal3ab_sessions').updateOne(
        { fbId: String(senderID) },
        { $set: { step: 'CHALLENGE_BET' } }
      );
      await sendReply(api, `${H}💰 أرسل قيمة الرهان من الكوينز للمباراة (أو أرسل 0 للعب للمتعة فقط وبدون رهان):`, messageID, threadID);
      return true;
    }
    await sendReply(api, `${H}⚠️ يرجى إرسال 1 للعب الفردي، 2 للتحدي، أو 0 للخروج.`, messageID, threadID);
    return true;
  }

  // 3. تحديد الرهان في وضع التحدي
  if (session.step === 'CHALLENGE_BET') {
    const bet = parseInt(text, 10);
    if (isNaN(bet) || bet < 0) {
      await sendReply(api, `${H}⚠️ يرجى إدخال رقم صحيح وصالح للرهان.`, messageID, threadID);
      return true;
    }

    const hostPlayer = await getPlayer(senderID);
    if (hostPlayer.coins < bet) {
      await sendReply(api, `${H}❌ ليس لديك رصيد كافي للرهان بهذا المبلغ! رصيدك الحالي: ${hostPlayer.coins} كوينز. أعد إدخال مبلغ آخر أو أرسل 0:`, messageID, threadID);
      return true;
    }

    await db.collection('dar_alal3ab_sessions').updateOne(
      { fbId: String(senderID) },
      { $set: { step: 'CHALLENGE_OPPONENT', bet: bet } }
    );
    await sendReply(api, `${H}👤 أرسل الآن لقب أو آيدي اللاعب الذي تود تحديه ومنافسته:`, messageID, threadID);
    return true;
  }

  // 4. تحديد الخصم وتأكيد كفايته وإرسال الدعوة
  if (session.step === 'CHALLENGE_OPPONENT') {
    let targetPlayer = null;
    const fbId = extractFbId(text);

    if (fbId) targetPlayer = await getPlayer(fbId);
    if (!targetPlayer) targetPlayer = await getPlayerByNicknameRegex(text);

    if (!targetPlayer) {
      await sendReply(api, `${H}❌ لم يتم العثور على هذا اللاعب في نظام نيكسوس. أرسل لقباً صحيحاً أو أرسل خروج للخروج:`, messageID, threadID);
      return true;
    }

    if (String(targetPlayer.fbId) === String(senderID)) {
      await sendReply(api, `${H}❌ لا يمكنك تحدي نفسك! اختر لاعباً آخر:`, messageID, threadID);
      return true;
    }

    // التحقق من كفاية الكوينز للخصم
    const bet = session.bet || 0;
    if (targetPlayer.coins < bet) {
      await sendReply(api, `${H}❌ اللاعب الآخر لا يملك كوينز كافي للعب بهذا الرهان! أرسل لقب أو آيدي لاعب آخر أو أرسل خروج للخروج:`, messageID, threadID);
      return true;
    }

    // لعبة الغميضة تحدي لا تلعب بنفس المملكة
    const hostPlayer = await getPlayer(senderID);
    if (session.gameKey === 'hide_seek' && hostPlayer.kingdom === targetPlayer.kingdom) {
      await sendReply(api, `${H}❌ لعبة الغميضة تحدي لا يمكن لعبها مع شخص من نفس مملكتك حرصاً على سرية الاختباء! اختر خصماً من مملكة أخرى:`, messageID, threadID);
      return true;
    }

    // إلغاء كبينة التسجيل المؤقتة للبدء في الدعوة الرسمية
    await db.collection('dar_alal3ab_sessions').deleteOne({ fbId: String(senderID) });

    // إنشاء جلسة دعوة رسمية
    const invitationId = `invite_${Date.now()}_${senderID}`;
    await db.collection('game_invitations').insertOne({
      _id: invitationId,
      gameKey: session.gameKey,
      gameName: session.gameName,
      hostFbId: String(senderID),
      hostNickname: hostPlayer.nickname,
      hostThreadId: String(threadID),
      opponentFbId: String(targetPlayer.fbId),
      opponentNickname: targetPlayer.nickname,
      opponentThreadId: config.groupes[targetPlayer.kingdom] || threadID,
      bet: bet,
      createdAt: new Date()
    });

    // إرسال دعوة التحدي عبر الإشعارات بدل رسالة جروب
    const inviteMsg = 
      `🎮 تلقيت دعوة تحدي جديدة!\n` +
      `👤 من اللاعب: ⟦ ${hostPlayer.nickname} ⟧\n` +
      `🕹️ اللعبة: ⟦ ${session.gameName} ⟧\n` +
      `💰 الرهان: ⟦ ${bet} 🪙 ⟧\n` +
      `👉 افتح دار الألعاب وادخل على وضع التحدي للقبول أو الرفض`;

    await addNotification(String(targetPlayer.fbId), inviteMsg);
    await sendReply(api, `${H}✅ تم إرسال طلب التحدي عبر الإشعارات إلى اللاعب ⟦ ${targetPlayer.nickname} ⟧ بانتظار قبوله...`, messageID, threadID);
    return true;
  }

  return false;
}

// ===== معالجة الردود على الدعوات (قبول / رفض) =====
async function handleGameInvitationReply(api, event) {
  const { threadID, senderID, messageID, body, messageReply } = event;
  const text = (body || '').trim();
  if (!messageReply) return false;

  const replyBody = messageReply.body || '';
  if (!replyBody.includes('تلقيت دعوة تحدي جديدة!')) return false;

  const db = getDB();
  const invitation = await db.collection('game_invitations').findOne({
    opponentFbId: String(senderID)
  });

  if (!invitation) return false;

  if (text === 'قبول') {
    // التحقق من توافر كوينز الطرفين مجدداً قبل المباشرة
    const p1 = await getPlayer(invitation.hostFbId);
    const p2 = await getPlayer(invitation.opponentFbId);

    if (p1.coins < invitation.bet || p2.coins < invitation.bet) {
      await sendReply(api, `${H}❌ فشل بدء التحدي لعدم توفر رصيد الرهان الكافي لدى أحد الطرفين حالياً.`, messageID, threadID);
      await db.collection('game_invitations').deleteOne({ _id: invitation._id });
      return true;
    }

    // خصم الرهان مؤقتاً لحين انتهاء اللعبة
    if (invitation.bet > 0) {
      await updatePlayer(invitation.hostFbId, { coins: p1.coins - invitation.bet });
      await updatePlayer(invitation.opponentFbId, { coins: p2.coins - invitation.bet });
    }

    // بدء جلسة اللعبة الفعلية بالتفاصيل الأولية
    const sessionData = {
      _id: `game_${Date.now()}`,
      gameKey: invitation.gameKey,
      gameName: invitation.gameName,
      mode: 'challenge',
      players: [invitation.hostFbId, invitation.opponentFbId],
      playerNames: {
        [invitation.hostFbId]: invitation.hostNickname,
        [invitation.opponentFbId]: invitation.opponentNickname
      },
      playerThreads: {
        [invitation.hostFbId]: invitation.hostThreadId,
        [invitation.opponentFbId]: invitation.opponentThreadId
      },
      playerKingdoms: {
        [invitation.hostFbId]: p1.kingdom,
        [invitation.opponentFbId]: p2.kingdom
      },
      bet: invitation.bet,
      status: 'active',
      turn: invitation.hostFbId, // المستضيف يبدأ دائماً
      gameState: await initGameState(invitation.gameKey, invitation.hostFbId, invitation.opponentFbId),
      lastActivity: new Date()
    };

    await db.collection('active_game_sessions').insertOne(sessionData);
    await db.collection('game_invitations').deleteOne({ _id: invitation._id });

    // إرسال إشعار البدء لكلا المجموعتين
    await sendMessage(api, `${H}🎮 تم قبول التحدي! بدأت الآن مباراة ⟦ ${invitation.gameName} ⟧ ضد ⟦ ${invitation.opponentNickname} ⟧! الرهان: ${invitation.bet} كوينز.`, invitation.hostThreadId);
    await sendMessage(api, `${H}🎮 بدأت الآن مباراة ⟦ ${invitation.gameName} ⟧ ضد ⟦ ${invitation.hostNickname} ⟧! الرهان: ${invitation.bet} كوينز.`, invitation.opponentThreadId);

    // توجيه ضربة البداية للمضيف
    await promptPlayerTurn(api, sessionData, invitation.hostFbId);
    return true;

  } else if (text === 'رفض') {
    await db.collection('game_invitations').deleteOne({ _id: invitation._id });
    await sendMessage(api, `${H}❌ رفض اللاعب ⟦ ${invitation.opponentNickname} ⟧ طلب التحدي الخاص بك لـ ⟦ ${invitation.gameName} ⟧.`, invitation.hostThreadId);
    await sendReply(api, `${H}🚪 تم رفض الدعوة بنجاح.`, messageID, threadID);
    return true;
  }

  return false;
}

// ===== تهيئة الحالة الداخلية للألعاب المحددة =====
async function initGameState(gameKey, p1, p2) {
  const state = {};
  if (gameKey === 'xo') {
    state.board = Array(9).fill(null);
    state.symbols = { [p1]: '❌', [p2]: '🟢' };
  } else if (gameKey === 'guess') {
    state.secretNumber = Math.floor(Math.random() * 100) + 1;
  } else if (gameKey === 'word_assemble') {
    const word = NEXUS_WORDS[Math.floor(Math.random() * NEXUS_WORDS.length)];
    state.word = word;
    state.scrambled = scrambleWord(word);
  } else if (gameKey === 'word_disassemble') {
    const word = NEXUS_WORDS[Math.floor(Math.random() * NEXUS_WORDS.length)];
    state.word = word;
    state.scrambled = word.split('').join(' ');
  } else if (gameKey === 'guess_flag') {
    const item = FLAG_DB[Math.floor(Math.random() * FLAG_DB.length)];
    state.flag = item.flag;
    state.answer = item.ans;
  } else if (gameKey === 'bomb') {
    state.wires = [...BOMB_WIRES];
    state.bombIndex = Math.floor(Math.random() * BOMB_WIRES.length);
  } else if (gameKey === 'hide_seek') {
    state.hidingBox = null; // سيحدده المختبئ
    state.seekerAttempts = 3;
    state.hider = p1; // سيتم تحديد المختبئ بالدور العشوائي لاحقاً
  } else if (gameKey === 'pinata') {
    state.hp = 100;
  } else if (gameKey === 'cards') {
    const deck = Array.from({ length: 10 }, (_, i) => i + 1);
    shuffleArray(deck);
    state.p1_cards = deck.slice(0, 5);
    state.p2_cards = deck.slice(5, 10);
    state.p1_selection = null;
    state.p2_selection = null;
    state.p1_score = 0;
    state.p2_score = 0;
    state.round = 1;
    state.roundMode = Math.random() > 0.5 ? 'الأكبر' : 'الأصغر';
  } else if (gameKey === 'intruder') {
    const data = generateIntruderGrid();
    state.grid = data.grid;
    state.intruder = data.intruder;
  }
  return state;
}

// ===== معالجة الوضع الفردي (Single Player) للألعاب المحددة =====
async function startSinglePlayerGame(api, event, session) {
  const { threadID, senderID, messageID } = event;
  const db = getDB();

  await db.collection('dar_alal3ab_sessions').deleteOne({ fbId: String(senderID) });

  const gameState = await initGameState(session.gameKey, senderID, 'bot');
  const sessionData = {
    _id: `game_single_${Date.now()}_${senderID}`,
    gameKey: session.gameKey,
    gameName: session.gameName,
    mode: 'single',
    players: [senderID],
    playerNames: { [senderID]: 'أنت' },
    playerThreads: { [senderID]: String(threadID) },
    bet: 0,
    status: 'active',
    gameState: gameState,
    lastActivity: new Date()
  };

  // معالجة بداية الألعاب للوضع الفردي وتوجيه العرض
  if (session.gameKey === 'xo') {
    // تحديد عشوائي لمن يبدأ
    const pStarts = Math.random() > 0.5;
    sessionData.turn = pStarts ? senderID : 'bot';
    sessionData.gameState.symbols = { [senderID]: '❌', 'bot': '🟢' };

    await db.collection('active_game_sessions').insertOne(sessionData);

    if (!pStarts) {
      // البوت يلعب الضربة الأولى تلقائياً
      sessionData.gameState.board[4] = '🟢';
      sessionData.turn = senderID;
      await db.collection('active_game_sessions').updateOne({ _id: sessionData._id }, { $set: { gameState: sessionData.gameState, turn: senderID } });
      await sendReply(api, `🤖 قرر البوت البدء أولاً ووضع 🟢 في الوسط!\n` + renderXOBoard(sessionData.gameState.board) + `\nإنه دورك الآن ارسل رقم المربع لوضع ❌.`, messageID, threadID);
    } else {
      await sendReply(api, `🎮 قررت القرعة أن تبدأ أولاً ورمزك ❌!\n` + renderXOBoard(sessionData.gameState.board) + `\nإنه دورك الآن ارسل رقم المربع لوضع ❌.`, messageID, threadID);
    }
    return;
  }

  await db.collection('active_game_sessions').insertOne(sessionData);

  if (session.gameKey === 'guess') {
    await sendReply(api, `${H}🔢 تم اختيار رقم سري بين 1 و 100 عشوائياً. لديك 30 ثانية لتخمينه!\nتنبيه: يفوز التخمين الصحيح أو الذي يبعد بفارق 3 درجات فقط. أرسل تخمينك الأول:`, messageID, threadID);
  } else if (session.gameKey === 'word_assemble') {
    await sendReply(api, `🔤 قم بتجميع الأحرف المبعثرة التالية:\n『 ${gameState.scrambled} 』\n\nأرسل الكلمة المجمعة الصحيحة:`, messageID, threadID);
  } else if (session.gameKey === 'word_disassemble') {
    await sendReply(api, `🔤 قم بتفكيك الكلمة التالية بوضع مسافة واحدة بين كل حرف وحرف:\n『 ${gameState.word} 』\n\nأرسل الكلمة المفككة:`, messageID, threadID);
  } else if (session.gameKey === 'guess_flag') {
    await sendReply(api, `🌍 احزر البلد المطابق لهذا العلم:\n『 ${gameState.flag} 』\n\nأرسل اسم البلد المقابل:`, messageID, threadID);
  } else if (session.gameKey === 'bomb') {
    await sendReply(api, `💣 القنبلة جاهزة بـ 10 خيوط! خيط واحد عشوائي سيفجرها.\nالخيوط المتاحة:\n` + renderWires(gameState.wires) + `\n\nأرسل رقم الخيط لقطعه وحظاً موفقاً:`, messageID, threadID);
  } else if (session.gameKey === 'hide_seek') {
    gameState.hidingBox = Math.floor(Math.random() * 10) + 1;
    gameState.seekerAttempts = 5;
    await db.collection('active_game_sessions').updateOne({ _id: sessionData._id }, { $set: { gameState: gameState } });
    await sendReply(api, `📦 اختبأ البوت في صندوق عشوائي من بين 10 صناديق.\nلديك 5 محاولات للبحث عنه!\nأرسل رقم الصندوق من 1 إلى 10 للبحث:`, messageID, threadID);
  } else if (session.gameKey === 'pinata') {
    await sendReply(api, `🪅 البنياتا أمامك وصحتها 100%!\nأرسل كلمة 《 اضرب 》 لتوجيه ضربة قوية ومحاولة كسرها:`, messageID, threadID);
  } else if (session.gameKey === 'cards') {
    await sendReply(api, `${H}❌ عذراً، لعبة البطاقات مخصصة لوضع التحدي الجماعي فقط ولا يمكن لعبها فردياً.`, messageID, threadID);
    await db.collection('active_game_sessions').deleteOne({ _id: sessionData._id });
  } else if (session.gameKey === 'intruder') {
    await sendReply(api, `🧐 ابحث عن الإيموجي الدخيل (الذي لا يملك زوجاً مطابقاً) من بين الـ 31 إيموجي التالية:\n\n${gameState.grid}\n\nلديك 30 ثانية لإرسال الإيموجي الدخيل الصحيح للفوز!`, messageID, threadID);
  }
}

// ===== معالجة مدخلات اللعب النشط =====
async function handleActiveGameInput(api, event) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();
  const db = getDB();

  // جلب جلسة اللعب النشطة للاعب
  const session = await db.collection('active_game_sessions').findOne({
    players: String(senderID),
    status: 'active'
  });

  if (!session) return false;

  await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { lastActivity: new Date() } });

  // ── 1. الخروج الاضطراري ──
  if (text === 'استسلام' || text === 'انسحاب') {
    await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    if (session.mode === 'challenge') {
      const opponentId = session.players.find(p => p !== String(senderID));
      const opponentName = session.playerNames[opponentId];
      
      // تعويض الخصم بالرهان الكلي
      if (session.bet > 0) {
        const opponentDoc = await getPlayer(opponentId);
        await updatePlayer(opponentId, { coins: (opponentDoc.coins || 0) + (session.bet * 2) });
      }

      await sendMessage(api, `🚪 انسحب اللاعب ⟦ ${session.playerNames[senderID]} ⟧ من المباراة.\n🏆 تم إعلان اللاعب ⟦ ${opponentName} ⟧ فائزاً بالانسحاب وحصل على قيمة الرهان كاملاً!`, session.playerThreads[opponentId]);
    }
    await sendReply(api, `${H}🚪 تم الانسحاب بنجاح والهروب من المباراة!`, messageID, threadID);
    return true;
  }

  // ── 2. اللعب الفردي (Single Player) ──
  if (session.mode === 'single') {
    await processSinglePlayerInput(api, event, session, text);
    return true;
  }

  // ── 3. التحدي الجماعي (Challenge Player) ──
  await processChallengeInput(api, event, session, text);
  return true;
}

// ===== تفاصيل عمليات معالجة اللعب الفردي =====
async function processSinglePlayerInput(api, event, session, text) {
  const { threadID, senderID, messageID } = event;
  const db = getDB();
  const state = session.gameState;

  // تحقق وقت الألعاب المؤقتة بـ 30 ثانية
  const playTimeSec = (Date.now() - new Date(session.lastActivity).getTime()) / 1000;
  if (['guess', 'word_assemble', 'word_disassemble', 'guess_flag', 'intruder'].includes(session.gameKey) && playTimeSec > 35) {
    await sendReply(api, `⏱️ انتهت المهلة المحددة للعب (30 ثانية) وخسرت الجولة! حظاً أوفر في المرة القادمة.`, messageID, threadID);
    await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    return;
  }

  // اللعبة 1: اكس أو فردي
  if (session.gameKey === 'xo') {
    if (session.turn !== senderID) {
      await sendReply(api, `${H}⚠️ انتظر دورك حالياً! البوت يفكر في خطوته.`, messageID, threadID);
      return;
    }
    const cell = parseInt(text, 10) - 1;
    if (isNaN(cell) || cell < 0 || cell > 8 || state.board[cell] !== null) {
      await sendReply(api, `${H}⚠️ يرجى إدخال رقم مربع صحيح فارغ (من 1 إلى 9):`, messageID, threadID);
      return;
    }

    state.board[cell] = '❌';

    // فحص الفوز للاعب
    if (checkXOWinner(state.board, '❌')) {
      await sendReply(api, `🎉 مبروك! لقد فزت في اللعبة وهزمت البوت!\n` + renderXOBoard(state.board) + `\n🏆 حصلت على مكافأة: ⛁ 2 كوينز!`, messageID, threadID);
      const player = await getPlayer(senderID);
      await updatePlayer(senderID, { coins: (player.coins || 0) + 2 });
      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
      return;
    }

    // فحص التعادل قبل لعب البوت (حالة لا تبقى إلا خلية واحدة)
    if (!state.board.includes(null)) {
      await sendReply(api, `🤝 تعادل! لقد انتهت جميع المربعات دون فائز.\n` + renderXOBoard(state.board), messageID, threadID);
      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
      return;
    }

    // لعب البوت
    const botCell = findBestXOMove(state.board, '🟢', '❌');
    if (botCell === undefined || botCell === null) {
      // لا توجد خلايا متاحة — تعادل
      await sendReply(api, `🤝 تعادل! لقد انتهت جميع المربعات دون فائز.\n` + renderXOBoard(state.board), messageID, threadID);
      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
      return;
    }
    state.board[botCell] = '🟢';

    // فحص الفوز للبوت
    if (checkXOWinner(state.board, '🟢')) {
      await sendReply(api, `😢 خسارة! لقد تمكن البوت من الفوز عليك.\n` + renderXOBoard(state.board) + `\nحاول مجدداً للتفوق عليه!`, messageID, threadID);
      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
      return;
    }

    await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { gameState: state } });
    await sendReply(api, `🤖 لعب البوت حركته ووضع 🟢!\n` + renderXOBoard(state.board) + `\nارسل رقم المربع لدورك التالي:`, messageID, threadID);
    return;
  }

  // اللعبة 2: تخمين الرقم فردي
  if (session.gameKey === 'guess') {
    const guessNum = parseInt(text, 10);
    if (isNaN(guessNum)) {
      await sendReply(api, `${H}⚠️ يرجى إدخال رقم تخمين صحيح بين 1 و 100:`, messageID, threadID);
      return;
    }

    const diff = Math.abs(guessNum - state.secretNumber);
    if (diff <= 3) {
      await sendReply(api, `🎉 مبروك! التخمين صحيح وصائب (الرقم السري كان: ${state.secretNumber}). لقد فزت بـ 2 كوينز!`, messageID, threadID);
      const player = await getPlayer(senderID);
      await updatePlayer(senderID, { coins: (player.coins || 0) + 2 });
      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    } else {
      const hint = guessNum < state.secretNumber ? 'أكبر 🔼' : 'أقل 🔽';
      await sendReply(api, `❌ التخمين خاطئ! الرقم السري هو ${hint} من تخمينك. أرسل تخميناً آخر:`, messageID, threadID);
    }
    return;
  }


  // اللعبة 5: تجميع الكلمات فردي
  if (session.gameKey === 'word_assemble') {
    if (text === state.word) {
      await sendReply(api, `🎉 تجميع صحيح! الكلمة هي ⟦ ${state.word} ⟧. حصلت على 2 كوينز!`, messageID, threadID);
      const player = await getPlayer(senderID);
      await updatePlayer(senderID, { coins: (player.coins || 0) + 2 });
    } else {
      await sendReply(api, `❌ تجميع خاطئ! الكلمة الصحيحة كانت: ⟦ ${state.word} ⟧.`, messageID, threadID);
    }
    await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    return;
  }

  // اللعبة 6: تفكيك الكلمات فردي
  if (session.gameKey === 'word_disassemble') {
    if (text === state.scrambled) {
      await sendReply(api, `🎉 تفكيك صحيح وممتاز! حصلت على 2 كوينز!`, messageID, threadID);
      const player = await getPlayer(senderID);
      await updatePlayer(senderID, { coins: (player.coins || 0) + 2 });
    } else {
      await sendReply(api, `❌ تفكيك خاطئ! التفكيك الصحيح للكلمة هو: ⟦ ${state.scrambled} ⟧.`, messageID, threadID);
    }
    await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    return;
  }

  // اللعبة 7: علم الدولة فردي
  if (session.gameKey === 'guess_flag') {
    if (text.includes(state.answer)) {
      await sendReply(api, `🎉 احراز صحيح وممتاز! البلد المقابل للعلم هو بالفعل ⟦ ${state.answer} ⟧. حصلت على 2 كوينز!`, messageID, threadID);
      const player = await getPlayer(senderID);
      await updatePlayer(senderID, { coins: (player.coins || 0) + 2 });
    } else {
      await sendReply(api, `❌ احراز خاطئ! البلد المقابل للعلم المعروض هو: ⟦ ${state.answer} ⟧.`, messageID, threadID);
    }
    await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    return;
  }

  // اللعبة 8: خيوط القنبلة فردي
  if (session.gameKey === 'bomb') {
    const choice = parseInt(text, 10);
    if (isNaN(choice) || choice < 1 || choice > 10 || !state.wires[choice - 1] || state.wires[choice - 1] === '✂️') {
      await sendReply(api, `${H}⚠️ يرجى إرسال رقم خيط صالح متوفر في القائمة لقطعه.`, messageID, threadID);
      return;
    }

    const index = choice - 1;
    if (index === state.bombIndex) {
      await sendReply(api, `💥 طووووم... بوم! لقد قمت بقطع الخيط الخاطئ وانفجرت القنبلة! للاسف خسرت الجولة.`, messageID, threadID);
      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    } else {
      state.wires[index] = '✂️';
      const available = state.wires.filter(w => w !== '✂️').length;

      if (available === 1) {
        await sendReply(api, `🎉 مبروك! تمكنت من تفكيك القنبلة بنجاح وبقي فقط الخيط المتفجر دون قطعه! حصلت على 2 كوينز!`, messageID, threadID);
        const player = await getPlayer(senderID);
        await updatePlayer(senderID, { coins: (player.coins || 0) + 2 });
        await db.collection('active_game_sessions').deleteOne({ _id: session._id });
      } else {
        await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { gameState: state } });
        await sendReply(api, `✅ الخيط آمن وسليم! تم قطعه بنجاح.\nالقنبلة لا زالت نشطة، الخيوط المتبقية:\n` + renderWires(state.wires) + `\n\nأرسل الخيط التالي لقطعه:`, messageID, threadID);
      }
    }
    return;
  }

  // اللعبة 10: الغميضة فردي
  if (session.gameKey === 'hide_seek') {
    const guess = parseInt(text, 10);
    if (isNaN(guess) || guess < 1 || guess > 10) {
      await sendReply(api, `${H}⚠️ أرسل رقم صندوق صحيح للبحث من 1 إلى 10:`, messageID, threadID);
      return;
    }

    state.seekerAttempts--;
    if (guess === state.hidingBox) {
      await sendReply(api, `🎉 رائع! تمكنت من العثور على البوت المختبئ في الصندوق رقم ${state.hidingBox}! حصلت على 2 كوينز!`, messageID, threadID);
      const player = await getPlayer(senderID);
      await updatePlayer(senderID, { coins: (player.coins || 0) + 2 });
      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    } else {
      if (state.seekerAttempts <= 0) {
        await sendReply(api, `😢 نفدت محاولاتك! لم تجد البوت وكان يختبئ في الصندوق رقم: ${state.hidingBox}.`, messageID, threadID);
        await db.collection('active_game_sessions').deleteOne({ _id: session._id });
      } else {
        await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { gameState: state } });
        await sendReply(api, `❌ لم تجده هناك! الصندوق فارغ.\nمتبقي لديك: ${state.seekerAttempts} محاولات. أرسل رقم صندوق آخر:`, messageID, threadID);
      }
    }
    return;
  }

  // اللعبة 11: البنياتا فردي
  if (session.gameKey === 'pinata') {
    if (text !== 'اضرب' && text !== 'ضرب') {
      await sendReply(api, `${H}⚠️ أرسل كلمة 《 اضرب 》 لضرب البنياتا:`, messageID, threadID);
      return;
    }

    const pDmg = Math.floor(Math.random() * 10) + 3; // 3 - 12
    state.hp -= pDmg;

    if (state.hp <= 0) {
      await sendReply(api, `🎉 بوم! انكسرت البنياتا وتطايرت الحلوى والكوينز بضربتك القوية التي سببت ضرر: ${pDmg}%!\nلقد ربحت كوينز من داخلها حصلت على 2 كوينز!`, messageID, threadID);
      const player = await getPlayer(senderID);
      await updatePlayer(senderID, { coins: (player.coins || 0) + 2 });
      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    } else {
      // ضربة البوت التلقائية المقابلة
      const bDmg = Math.floor(Math.random() * 10) + 3;
      state.hp -= bDmg;

      if (state.hp <= 0) {
        await sendReply(api, `😢 انكسرت البنياتا بضربة البوت المقابلة التي سببت ضرر: ${bDmg}%! لقد ربح البوت الحلوى والكوينز بدلاً منك.`, messageID, threadID);
        await db.collection('active_game_sessions').deleteOne({ _id: session._id });
      } else {
        await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { gameState: state } });
        await sendReply(api, `💥 ضربتك أحدثت ضرر ${pDmg}%!\n🤖 ضربة البوت المقابلة أحدثت ضرر ${bDmg}%!\n\nصحة البنياتا الحالية: 🪅 ${Math.max(0, state.hp)}%\nأرسل 《 اضرب 》 للضربة التالية:`, messageID, threadID);
      }
    }
    return;
  }

  // اللعبة 13: الدخيل فردي
  if (session.gameKey === 'intruder') {
    if (text === state.intruder) {
      await sendReply(api, `🎉 صحيح ومذهل! لقد رصدت الدخيل بنجاح وهو: 『 ${state.intruder} 』. حصلت على 2 كوينز!`, messageID, threadID);
      const player = await getPlayer(senderID);
      await updatePlayer(senderID, { coins: (player.coins || 0) + 2 });
    } else {
      await sendReply(api, `❌ خطأ! الإيموجي الدخيل الفريد كان: 『 ${state.intruder} 』.`, messageID, threadID);
    }
    await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    return;
  }
}

// ===== تفاصيل قنوات وتوجيه تفاعلات وضع التحدي الجماعي =====
async function processChallengeInput(api, event, session, text) {
  const { threadID, senderID, messageID } = event;
  const db = getDB();
  const state = session.gameState;

  const opponentId = session.players.find(p => p !== String(senderID));
  const t1 = session.playerThreads[senderID];
  const t2 = session.playerThreads[opponentId];

  // ألعاب السرعة: الدخيل، أسئلة ثقافية ودينية، تجميع وتفكيك، البلد من العلم
  const speedGames = ['word_assemble', 'word_disassemble', 'guess_flag', 'intruder'];
  if (speedGames.includes(session.gameKey)) {
    let winnerId = null;
    let isCorrect = false;

    if (session.gameKey === 'word_assemble') {
      isCorrect = (text === state.word);
    } else if (session.gameKey === 'word_disassemble') {
      isCorrect = (text === state.scrambled);
    } else if (session.gameKey === 'guess_flag') {
      isCorrect = text.includes(state.answer);
    } else if (session.gameKey === 'intruder') {
      isCorrect = (text === state.intruder);
    }

    if (isCorrect) {
      winnerId = String(senderID);
      const prize = session.bet * 2;

      if (session.bet > 0) {
        const player = await getPlayer(winnerId);
        await updatePlayer(winnerId, { coins: (player.coins || 0) + prize });
      }

      const winMsg = `🏆 فوز! أرسل اللاعب ⟦ ${session.playerNames[winnerId]} ⟧ الإجابة الصحيحة أولاً وهي: ⟦ ${state.word || state.scrambled || state.answer || state.intruder} ⟧!\nوربح الرهان الكلي المقدر بـ: ${prize} كوينز.`;
      await sendMessage(api, winMsg, t1);
      if (t1 !== t2) await sendMessage(api, winMsg, t2);

      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    } else {
      await sendReply(api, `❌ إجابة خاطئة! أسرع في المحاولة قبل خصمك...`, messageID, threadID);
    }
    return;
  }

  // الألعاب التي تطلب أدواراً متعاقبة بالتناوب
  if (session.turn !== String(senderID)) {
    await sendReply(api, `${H}⚠️ انتظر دور خصمك للعب حركته أولاً!`, messageID, threadID);
    return;
  }

  // لعبة 1: اكس أو تحدي
  if (session.gameKey === 'xo') {
    const cell = parseInt(text, 10) - 1;
    if (isNaN(cell) || cell < 0 || cell > 8 || state.board[cell] !== null) {
      await sendReply(api, `${H}⚠️ يرجى إدخال رقم مربع صحيح فارغ (من 1 إلى 9):`, messageID, threadID);
      return;
    }

    const symbol = state.symbols[senderID];
    state.board[cell] = symbol;

    if (checkXOWinner(state.board, symbol)) {
      const prize = session.bet * 2;
      if (session.bet > 0) {
        const player = await getPlayer(senderID);
        await updatePlayer(senderID, { coins: (player.coins || 0) + prize });
      }

      const boardStr = renderXOBoard(state.board);
      const xoWinMsg = `🏆 فاز ⟦ ${session.playerNames[senderID]} ⟧ في تحدي اكس أو وحصد الرهان: ${prize} كوينز!\n` + boardStr;
      await sendMessage(api, xoWinMsg, t1);
      if (t1 !== t2) await sendMessage(api, xoWinMsg, t2);

      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
      return;
    }

    if (!state.board.includes(null)) {
      const boardStr = renderXOBoard(state.board);
      const xoDrawMsg = `🤝 تعادل! انتهى التحدي بالتعادل بين اللاعبين واسترداد الرهان.\n` + boardStr;
      await sendMessage(api, xoDrawMsg, t1);
      if (t1 !== t2) await sendMessage(api, xoDrawMsg, t2);

      if (session.bet > 0) {
        const p1Doc = await getPlayer(session.players[0]);
        const p2Doc = await getPlayer(session.players[1]);
        await updatePlayer(session.players[0], { coins: (p1Doc.coins || 0) + session.bet });
        await updatePlayer(session.players[1], { coins: (p2Doc.coins || 0) + session.bet });
      }

      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
      return;
    }

    // تبديل الدور للاعب الآخر
    session.turn = opponentId;
    await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { gameState: state, turn: opponentId } });

    // إرسال اللوحة حسب المملكة والقروبات المختلفة
    const boardStr = renderXOBoard(state.board);
    if (t1 === t2) {
      await sendMessage(api, `🎮 دور ⟦ ${session.playerNames[opponentId]} ⟧ الآن! خصمه لعب بوضع ${symbol}.\n` + boardStr + `\nأرسل رقم المربع الصالح للدور:`, t1);
    } else {
      await sendMessage(api, `✅ لعبت دورك بنجاح بوضع ${symbol}.\nبانتظار دور الخصم للعب...\n` + boardStr, t1);
      await sendMessage(api, `🎮 جاء دورك الآن للعب حركتك! خصمك لعب بوضع ${symbol}.\n` + boardStr + `\nأرسل رقم المربع الصالح للدور:`, t2);
    }
    return;
  }

  // لعبة 2: تخمين الرقم تحدي بالتناوب
  if (session.gameKey === 'guess') {
    const guessNum = parseInt(text, 10);
    if (isNaN(guessNum)) {
      await sendReply(api, `${H}⚠️ يرجى إدخال رقم تخمين صحيح بين 1 و 100:`, messageID, threadID);
      return;
    }

    const diff = Math.abs(guessNum - state.secretNumber);
    if (diff <= 3) {
      const prize = session.bet * 2;
      if (session.bet > 0) {
        const player = await getPlayer(senderID);
        await updatePlayer(senderID, { coins: (player.coins || 0) + prize });
      }

      const guessWinMsg = `🏆 فاز ⟦ ${session.playerNames[senderID]} ⟧ بتخمين الرقم السري ${state.secretNumber} وحصد الرهان: ${prize} كوينز!`;
      await sendMessage(api, guessWinMsg, t1);
      if (t1 !== t2) await sendMessage(api, guessWinMsg, t2);

      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    } else {
      const hint = guessNum < state.secretNumber ? 'أكبر 🔼' : 'أقل 🔽';
      session.turn = opponentId;
      await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { turn: opponentId } });

      if (t1 === t2) {
        await sendMessage(api, `❌ خطأ من ⟦ ${session.playerNames[senderID]} ⟧! الرقم السري هو ${hint}.\n🎮 دور ⟦ ${session.playerNames[opponentId]} ⟧ الآن للتخمين:`, t1);
      } else {
        await sendMessage(api, `❌ تخمينك خاطئ! الرقم السري هو ${hint} من تخمين اللاعب. تم نقل الدور للخصم...`, t1);
        await sendMessage(api, `🎮 جاء دورك للتخمين! اللاعب الآخر خمن رقم وكانت نتيجته أن الرقم السري هو ${hint}.\nأرسل تخمينك الآن:`, t2);
      }
    }
    return;
  }

  // لعبة 8: خيوط القنبلة تحدي بالتناوب
  if (session.gameKey === 'bomb') {
    const choice = parseInt(text, 10);
    if (isNaN(choice) || choice < 1 || choice > 10 || !state.wires[choice - 1] || state.wires[choice - 1] === '✂️') {
      await sendReply(api, `${H}⚠️ يرجى إدخال رقم خيط صالح متوفر لقطعه.`, messageID, threadID);
      return;
    }

    const index = choice - 1;
    if (index === state.bombIndex) {
      // انفجرت القنبلة باللاعب الحالي ← الخصم يفوز بالرهان كاملاً
      const prize = session.bet * 2;
      if (session.bet > 0) {
        const player = await getPlayer(opponentId);
        await updatePlayer(opponentId, { coins: (player.coins || 0) + prize });
      }

      const bombMsg = `💥 انفجرت القنبلة في وجه ⟦ ${session.playerNames[senderID]} ⟧! فاز ⟦ ${session.playerNames[opponentId]} ⟧ برصيد الرهان: ${prize} كوينز.`;
      await sendMessage(api, bombMsg, t1);
      if (t1 !== t2) await sendMessage(api, bombMsg, t2);

      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    } else {
      state.wires[index] = '✂️';
      const available = state.wires.filter(w => w !== '✂️').length;

      if (available === 1) {
        // بقي خيط واحد وهو القنبلة ولم ينفجر باللاعب الحالي ← اللاعب الحالي يفوز بالذكاء وتجنب القنبلة
        const prize = session.bet * 2;
        if (session.bet > 0) {
          const player = await getPlayer(senderID);
          await updatePlayer(senderID, { coins: (player.coins || 0) + prize });
        }

        const bombWinMsg = `🎉 فاز ⟦ ${session.playerNames[senderID]} ⟧ بتفادي القنبلة وكشف جميع الخيوط الآمنة! وحصد الرهان: ${prize} كوينز.`;
        await sendMessage(api, bombWinMsg, t1);
        if (t1 !== t2) await sendMessage(api, bombWinMsg, t2);

        await db.collection('active_game_sessions').deleteOne({ _id: session._id });
      } else {
        session.turn = opponentId;
        await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { gameState: state, turn: opponentId } });

        const wiresStr = renderWires(state.wires);
        if (t1 === t2) {
          await sendMessage(api, `✅ قطع ⟦ ${session.playerNames[senderID]} ⟧ خيطاً آمناً!\n🎮 دور ⟦ ${session.playerNames[opponentId]} ⟧ الآن:\n` + wiresStr + `\nأرسل رقم الخيط المتاح لقطعه:`, t1);
        } else {
          await sendMessage(api, `✅ الخيط آمن وسليم! تم قطعه بنجاح.\nبانتظار الخصم لقطع خيطه...\n` + wiresStr, t1);
          await sendMessage(api, `🎮 جاء دورك لقطع أحد الخيوط! الخيوط المتاحة حالياً:\n` + wiresStr + `\n\nأرسل رقم الخيط المتاح لقطعه:`, t2);
        }
      }
    }
    return;
  }

  // لعبة 10: الغميضة تحدي (غير متاح في نفس المجموعة)
  if (session.gameKey === 'hide_seek') {
    // مرحلة 1: تسجيل مكان اختباء المختبئ
    if (state.hidingBox === null) {
      if (senderID !== state.hider) {
        await sendReply(api, `${H}⚠️ انتظر حتى يختار الخصم المختبئ صندوق الاختباء أولاً!`, messageID, threadID);
        return;
      }

      const box = parseInt(text, 10);
      if (isNaN(box) || box < 1 || box > 10) {
        await sendReply(api, `${H}⚠️ أرسل رقم صندوق صحيح لتختبئ داخله (من 1 إلى 10):`, messageID, threadID);
        return;
      }

      state.hidingBox = box;
      session.turn = opponentId; // نقل الدور للباحث
      await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { gameState: state, turn: opponentId } });

      if (t1 === t2) {
        await sendMessage(api, `🔒 اختبأ ⟦ ${session.playerNames[senderID]} ⟧ في صندوق سري!\n🎮 دور ⟦ ${session.playerNames[opponentId]} ⟧ الآن للبحث — لديه 3 محاولات.\nأرسل رقم الصندوق من 1 إلى 10:`, t1);
      } else {
        await sendMessage(api, `🔒 تم تسجيل صندوق اختبائك السري بنجاح!\nالآن سيبدأ خصمك بالبحث عنك ولديه 3 محاولات.`, t1);
        await sendMessage(api, `🎮 لقد اختبأ خصمك في أحد الصناديق السرية!\nلديك 3 محاولات لإيجاده.\nأرسل رقم الصندوق من 1 إلى 10 لبدء البحث:`, t2);
      }
      return;
    }

    // مرحلة 2: محاولات الباحث لتخمين صندوق المختبئ
    const guess = parseInt(text, 10);
    if (isNaN(guess) || guess < 1 || guess > 10) {
      await sendReply(api, `${H}⚠️ أرسل رقم صندوق صحيح للبحث من 1 إلى 10:`, messageID, threadID);
      return;
    }

    state.seekerAttempts--;
    if (guess === state.hidingBox) {
      const prize = session.bet * 2;
      if (session.bet > 0) {
        const player = await getPlayer(senderID);
        await updatePlayer(senderID, { coins: (player.coins || 0) + prize });
      }

      const foundMsg = `🏆 وجد ⟦ ${session.playerNames[senderID]} ⟧ المختبئ في الصندوق رقم ${state.hidingBox} وفاز بالرهان: ${prize} كوينز!`;
      await sendMessage(api, foundMsg, t1);
      if (t1 !== t2) await sendMessage(api, foundMsg, t2);

      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    } else {
      if (state.seekerAttempts <= 0) {
        // حان انتهاء المحاولات وفوز المختبئ
        const prize = session.bet * 2;
        if (session.bet > 0) {
          const player = await getPlayer(state.hider);
          await updatePlayer(state.hider, { coins: (player.coins || 0) + prize });
        }

        const hideWinMsg = `🏆 فاز ⟦ ${session.playerNames[state.hider]} ⟧ بالاختباء! نفدت محاولات الباحث — الصندوق كان: ${state.hidingBox}. الرهان: ${prize} كوينز.`;
        await sendMessage(api, hideWinMsg, t1);
        if (t1 !== t2) await sendMessage(api, hideWinMsg, t2);

        await db.collection('active_game_sessions').deleteOne({ _id: session._id });
      } else {
        await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { gameState: state } });
        if (t1 === t2) {
          await sendMessage(api, `❌ الصندوق رقم ${guess} فارغ! بحث فيه ⟦ ${session.playerNames[senderID]} ⟧.\nمتبقي لديه: ${state.seekerAttempts} محاولات. أرسل رقم صندوق آخر:`, t1);
        } else {
          await sendMessage(api, `👀 بحث خصمك في الصندوق رقم ${guess} ولم يجدك هناك!\nمتبقي لديه: ${state.seekerAttempts} محاولات.`, t1);
          await sendMessage(api, `❌ الصندوق رقم ${guess} فارغ!\nمتبقي لديك: ${state.seekerAttempts} محاولات. أرسل رقم صندوق آخر للبحث:`, t2);
        }
      }
    }
    return;
  }

  // لعبة 11: ضرب البنياتا تحدي بالتناوب
  if (session.gameKey === 'pinata') {
    if (text !== 'اضرب' && text !== 'ضرب') {
      await sendReply(api, `${H}⚠️ أرسل كلمة 《 اضرب 》 لضرب البنياتا بالتناوب:`, messageID, threadID);
      return;
    }

    const dmg = Math.floor(Math.random() * 10) + 3; // 3 - 12
    state.hp -= dmg;

    if (state.hp <= 0) {
      // انكسرت البنياتا على يد اللاعب الحالي ← يفوز بالرهان
      const prize = session.bet * 2;
      if (session.bet > 0) {
        const player = await getPlayer(senderID);
        await updatePlayer(senderID, { coins: (player.coins || 0) + prize });
      }

      const pinataWinMsg = `🏆 كسر ⟦ ${session.playerNames[senderID]} ⟧ البنياتا بضربة ${dmg}% وحصد الرهان: ${prize} كوينز!`;
      await sendMessage(api, pinataWinMsg, t1);
      if (t1 !== t2) await sendMessage(api, pinataWinMsg, t2);

      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    } else {
      session.turn = opponentId;
      await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { gameState: state, turn: opponentId } });

      if (t1 === t2) {
        await sendMessage(api, `💥 ضرب ⟦ ${session.playerNames[senderID]} ⟧ البنياتا وسبب ${dmg}% ضرر!\n🎮 دور ⟦ ${session.playerNames[opponentId]} ⟧ الآن — صحة البنياتا: 🪅 ${state.hp}%\nأرسل 《 اضرب 》:`, t1);
      } else {
        await sendMessage(api, `💥 سببت ضرراً للبنياتا بقدر: ${dmg}%!\nبانتظار ضربة خصمك المقابلة...\nصحة البنياتا الحالية: 🪅 ${state.hp}%`, t1);
        await sendMessage(api, `🎮 جاء دورك الآن لتوجيه ضربتك للبنياتا!\nصحة البنياتا الحالية: 🪅 ${state.hp}%\nأرسل 《 اضرب 》 لضربها:`, t2);
      }
    }
    return;
  }

  // لعبة 12: البطاقات تحدي بالبطاقات الـ 10 المقسمة
  if (session.gameKey === 'cards') {
    const p1 = session.players[0];
    const p2 = session.players[1];

    const isP1 = (senderID === p1);
    const letter = text.toUpperCase();

    const currentCards = isP1 ? state.p1_cards : state.p2_cards;
    const letters = ['A', 'B', 'C', 'D', 'E'];
    const idx = letters.indexOf(letter);

    if (idx === -1 || idx >= currentCards.length || currentCards[idx] === null) {
      await sendReply(api, `${H}⚠️ يرجى إرسال حرف بطاقة متوفر وصحيح من قائمتك النشطة.`, messageID, threadID);
      return;
    }

    const value = currentCards[idx];

    if (isP1) {
      if (state.p1_selection !== null) {
        await sendReply(api, `${H}⚠️ لقد قمت بتحديد بطاقتك بالفعل لهذه الجولة وبانتظار الخصم!`, messageID, threadID);
        return;
      }
      state.p1_selection = { value, letter, idx };
    } else {
      if (state.p2_selection !== null) {
        await sendReply(api, `${H}⚠️ لقد قمت بتحديد بطاقتك بالفعل لهذه الجولة وبانتظار الخصم!`, messageID, threadID);
        return;
      }
      state.p2_selection = { value, letter, idx };
    }

    await sendMessage(api, `✅ تم تسجيل بطاقتك المختارة بنجاح وبانتظار تحديد الخصم لبطاقته...`, threadID);

    // إذا اختار الطرفان بطاقتيهما يتم إنهاء الجولة فوراً وحساب النتيجة
    if (state.p1_selection !== null && state.p2_selection !== null) {
      const v1 = state.p1_selection.value;
      const v2 = state.p2_selection.value;

      let roundWinner = null;
      if (state.roundMode === 'الأكبر') {
        if (v1 > v2) roundWinner = p1;
        else if (v2 > v1) roundWinner = p2;
      } else {
        if (v1 < v2) roundWinner = p1;
        else if (v2 < v1) roundWinner = p2;
      }

      let resMsg = `📊 جولة رقم ${state.round} انتهت!\n🎯 هدف الجولة كان: ⟦ ${state.roundMode} ⟧\n`;
      resMsg += `👤 بطاقة ⟦ ${session.playerNames[p1]} ⟧ كانت: ${v1} (الحرف: ${state.p1_selection.letter})\n`;
      resMsg += `👤 بطاقة ⟦ ${session.playerNames[p2]} ⟧ كانت: ${v2} (الحرف: ${state.p2_selection.letter})\n\n`;

      if (roundWinner === p1) {
        state.p1_score++;
        resMsg += `🏆 فوز الجولة لـ: ⟦ ${session.playerNames[p1]} ⟧!`;
      } else if (roundWinner === p2) {
        state.p2_score++;
        resMsg += `🏆 فوز الجولة لـ: ⟦ ${session.playerNames[p2]} ⟧!`;
      } else {
        resMsg += `🤝 تعادل الجولة دون فائز!`;
      }

      // إزالة الكروت المستخدمة بوضع قيمتها null
      state.p1_cards[state.p1_selection.idx] = null;
      state.p2_cards[state.p2_selection.idx] = null;

      // تصفير الاختيارات للبدء في جولة جديدة
      state.p1_selection = null;
      state.p2_selection = null;
      state.round++;
      state.roundMode = Math.random() > 0.5 ? 'الأكبر' : 'الأصغر';

      await sendMessage(api, resMsg, t1);
      if (t1 !== t2) await sendMessage(api, resMsg, t2);

      if (state.round > 5) {
        // انتهاء المباراة وتحديد الفائز العام بالرهان
        let matchWinner = null;
        if (state.p1_score > state.p2_score) matchWinner = p1;
        else if (state.p2_score > state.p1_score) matchWinner = p2;

        const prize = session.bet * 2;
        let finalMsg = `🎮 انتهت مباراة البطاقات بالكامل بعد 5 جولات دامت بالتنافس!\n`;
        finalMsg += `🏁 النتيجة النهائية: ⟦ ${session.playerNames[p1]}: ${state.p1_score} ⟧ مقابل ⟦ ${session.playerNames[p2]}: ${state.p2_score} ⟧\n\n`;

        if (matchWinner) {
          if (session.bet > 0) {
            const player = await getPlayer(matchWinner);
            await updatePlayer(matchWinner, { coins: (player.coins || 0) + prize });
          }
          finalMsg += `🏆 الفائز العام بالمباراة هو اللاعب الممتاز ⟦ ${session.playerNames[matchWinner]} ⟧ وحصل على مبلغ الرهان: ${prize} كوينز!`;
        } else {
          // تعادل وإرجاع الكوينز
          if (session.bet > 0) {
            const doc1 = await getPlayer(p1);
            const doc2 = await getPlayer(p2);
            await updatePlayer(p1, { coins: (doc1.coins || 0) + session.bet });
            await updatePlayer(p2, { coins: (doc2.coins || 0) + session.bet });
          }
          finalMsg += `🤝 انتهى التحدي العام بالتعادل التام بين اللاعبين وتمت إعادة كوينز الرهان للجميع!`;
        }

        await sendMessage(api, finalMsg, t1);
        if (t1 !== t2) await sendMessage(api, finalMsg, t2);

        await db.collection('active_game_sessions').deleteOne({ _id: session._id });
      } else {
        await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { gameState: state } });
        // توجيه العرض للجولة الجديدة للطرفين
        await promptPlayerTurn(api, session, p1);
        await promptPlayerTurn(api, session, p2);
      }
    } else {
      await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { gameState: state } });
    }
    return;
  }
}

// ===== بدء لعبة شد الحبل التفاعلية في نفس المملكة =====
async function startTugOfWarChallenge(api, event, session) {
  const { threadID, senderID, messageID } = event;
  const db = getDB();

  await db.collection('dar_alal3ab_sessions').deleteOne({ fbId: String(senderID) });

  const hostPlayer = await getPlayer(senderID);

  const startMsg = 
    `📢 ━━━━━━━━━━━━━━━━ 📢\n` +
    `مرحبا انا اللاعب ⟦ ${hostPlayer.nickname} ⟧ شد الحبل معي لافوز!\n` +
    `👉 رد على هذه الرسالة واكتب 《 شد 》 لمساعدتي بالفوز والتغلب على التحدي!\n` +
    `⏱️ اللعبة مفتوحة للتفاعل لمدة 30 ثانية للجميع في المملكة!`;

  const info = await sendReply(api, startMsg, messageID, threadID);
  const botMessageId = info ? info.messageID : null;

  if (!botMessageId) {
    await sendReply(api, `${H}❌ حدث خطأ أثناء تشغيل شد الحبل.`, messageID, threadID);
    return;
  }

  // حفظ تفاصيل شد الحبل النشطة لتجميع الردود بـ 30 ثانية
  await db.collection('tug_of_war_sessions').insertOne({
    botMessageId: String(botMessageId),
    hostFbId: String(senderID),
    hostNickname: hostPlayer.nickname,
    threadID: String(threadID),
    clicks: 0,
    clickers: [],
    createdAt: new Date()
  });

  // مؤقت الإنهاء بـ 30 ثانية وتوزيع الكوينز للمشاركين
  setTimeout(async () => {
    try {
      const active = await db.collection('tug_of_war_sessions').findOne({ botMessageId: String(botMessageId) });
      if (active) {
        await db.collection('tug_of_war_sessions').deleteOne({ botMessageId: String(botMessageId) });

        const totalClicks = active.clicks || 0;
        const rewardCoins = Math.min(10, totalClicks); // حد أقصى للربح 10 كوينز

        if (totalClicks > 0) {
          const player = await getPlayer(active.hostFbId);
          await updatePlayer(active.hostFbId, { coins: (player.coins || 0) + rewardCoins });

          const endMsg = 
            `⏱️ انتهى وقت تحدي شد الحبل!\n` +
            `📊 إجمالي عدد الشدات المحصلة بفضل أصدقائك بالمملكة: ⟦ ${totalClicks} شدة ⟧!\n` +
            `🏆 فوز! ربح اللاعب ⟦ ${active.hostNickname} ⟧ مكافأة قدرها: ⛁ ${rewardCoins} كوينز بفضل تكاتفكم!`;
          await sendMessage(api, endMsg, active.threadID);
        } else {
          await sendMessage(api, `⏱️ انتهى وقت شد الحبل ولم يستجب أحد لرسالتك لتسجيل أي شدة! للاسف لم تحصل على أي مكافأة.`, active.threadID);
        }
      }
    } catch (err) {
      console.error('[TugOfWar] Error ending game:', err);
    }
  }, 30000);
}

// ===== معالجة الردود بكلمة "شد" للعبة شد الحبل =====
async function handleTugOfWarReply(api, event) {
  const { threadID, senderID, messageID, body, messageReply } = event;
  const text = (body || '').trim();
  if (!messageReply) return false;

  const replyBody = messageReply.body || '';
  if (!replyBody.includes('شد الحبل معي لافوز')) return false;

  if (text !== 'شد' && text !== 'شَد') return false;

  const db = getDB();
  const botMsgId = String(messageReply.messageID);

  const active = await db.collection('tug_of_war_sessions').findOne({ botMessageId: botMsgId });
  if (!active) return false;

  // تسجيل الشدة بنجاح
  await db.collection('tug_of_war_sessions').updateOne(
    { botMessageId: botMsgId },
    { 
      $inc: { clicks: 1 },
      $addToSet: { clickers: String(senderID) }
    }
  );

  // تفاعل سريع بصح على رسالة اللاعب المساعد كتشجيع
  api.setMessageReaction('💪', messageID, () => {}, true);
  return true;
}

// ===== توجيه إرشادات الدور حسب كروت وألعاب كل لاعب للتحديات النشطة =====
async function promptPlayerTurn(api, session, targetPlayerId) {
  const t = session.playerThreads[targetPlayerId];
  const name = session.playerNames[targetPlayerId];
  const state = session.gameState;

  if (session.gameKey === 'xo') {
    const symbol = state.symbols[targetPlayerId];
    await sendMessage(api, `🎮 جاء دورك الآن للعب حركتك بالتحدي! رمزك هو: ${symbol}.\nاللوحة الحالية:\n` + renderXOBoard(state.board) + `\n\nأرسل رقم المربع الصالح للعب حركتك:`, t);
  } else if (session.gameKey === 'guess') {
    await sendMessage(api, `🎮 جاء دورك الآن لتخمين الرقم السري! أرسل تخمينك المفضل بين 1 و 100:`, t);
  } else if (session.gameKey === 'bomb') {
    await sendMessage(api, `🎮 جاء دورك الآن لقطع أحد الخيوط! الخيوط المتاحة:\n` + renderWires(state.wires) + `\n\nأرسل رقم الخيط المتاح لقطعه:`, t);
  } else if (session.gameKey === 'hide_seek') {
    if (targetPlayerId === state.hider && state.hidingBox === null) {
      await sendMessage(api, `🎮 لقد حان دورك لتختبئ سرياً! الصناديق المتوفرة من 1 إلى 10.\nأرسل رقم صندوقك السري لتختبئ بداخله:`, t);
    }
  } else if (session.gameKey === 'pinata') {
    await sendMessage(api, `🎮 جاء دورك الآن لتوجيه ضربتك للبنياتا وصحتها 🪅 ${state.hp}%!\nأرسل كلمة 《 اضرب 》 لضرب البنياتا:`, t);
  } else if (session.gameKey === 'cards') {
    // عرض أوراق اللعب المتبقية والحروف المتاحة لكل لاعب لتحديد البطاقة بالسر
    const isP1 = (targetPlayerId === session.players[0]);
    const cards = isP1 ? state.p1_cards : state.p2_cards;
    const letters = ['A', 'B', 'C', 'D', 'E'];

    let cardsStr = `🃏 بطاقاتك المتبقية لهذه الجولة رقم ${state.round}:\n`;
    cards.forEach((v, idx) => {
      if (v !== null) {
        cardsStr += `   ✦ الحرف ${letters[idx]}  ◀  البطاقة رقم ${v}\n`;
      }
    });

    cardsStr += `\n🎯 هدف الجولة الحالي: ⟦ ${state.roundMode} ⟧\n`;
    cardsStr += `👉 أرسل حرف البطاقة الذي تود اللعب به بالسر للمنافسة في هذه الجولة:`;

    await sendMessage(api, cardsStr, t);
  }
}

// ===== أدوات المعالجة المساعدة وتوليد البيانات للألعاب =====

function scrambleWord(word) {
  const chars = word.split('');
  shuffleArray(chars);
  return chars.join(' ');
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function generateIntruderGrid() {
  const base = [...INTRUDER_EMOJIS];
  shuffleArray(base);
  
  // اختيار 15 إيموجي لتكوين الأزواج المتطابقة (15 * 2 = 30)
  const pairs = base.slice(0, 15);
  // اختيار إيموجي واحد دخيل فريد
  const intruder = base[15];

  const gridArray = [...pairs, ...pairs, intruder];
  shuffleArray(gridArray);

  return { grid: gridArray.join(' '), intruder };
}

function renderXOBoard(board) {
  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
  const grid = board.map((v, i) => v || emojis[i]);
  return `╗══╦══╦══╔\n` +
         `║ ${grid[0]} ║ ${grid[1]} ║ ${grid[2]} ║\n` +
         `╣══╬══╬══╠\n` +
         `║ ${grid[3]} ║ ${grid[4]} ║ ${grid[5]} ║\n` +
         `╣══╬══╬══╠\n` +
         `║ ${grid[6]} ║ ${grid[7]} ║ ${grid[8]} ║\n` +
         `╝══╩══╩══╚`;
}

function renderWires(wires) {
  return wires.map((w, i) => {
    if (w === '✂️') return `『 ${i + 1} 』✂️ مقطوع`;
    return `『 ${i + 1} 』${w} الخيط الملون`;
  }).join('\n');
}

// الذكاء الاصطناعي للبوت للعب الأفضل في تيك تاك تو
function checkXOWinner(board, symbol) {
  const winPatterns = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // الصفوف
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // الأعمدة
    [0, 4, 8], [2, 4, 6]             // الأقطار
  ];
  return winPatterns.some(p => p.every(idx => board[idx] === symbol));
}

function findBestXOMove(board, selfSymbol, oppSymbol) {
  // 1. فحص إمكانية فوز البوت مباشرة
  for (let i = 0; i < 9; i++) {
    if (board[i] === null) {
      board[i] = selfSymbol;
      if (checkXOWinner(board, selfSymbol)) {
        board[i] = null;
        return i;
      }
      board[i] = null;
    }
  }

  // 2. فحص إمكانية حجب فوز اللاعب المقابل
  for (let i = 0; i < 9; i++) {
    if (board[i] === null) {
      board[i] = oppSymbol;
      if (checkXOWinner(board, oppSymbol)) {
        board[i] = null;
        return i;
      }
      board[i] = null;
    }
  }

  // 3. اختيار المربع الأوسط كأفضل بديل
  if (board[4] === null) return 4;

  // 4. اختيار عشوائي من المربعات المتبقية المتاحة
  const av = [];
  board.forEach((v, i) => { if (v === null) av.push(i); });
  return av[Math.floor(Math.random() * av.length)];
}

async function getPlayerByNicknameRegex(nickname) {
  try {
    const db = getDB();
    const cleanNick = nickname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return await db.collection('players').findOne({
      nickname: { $regex: new RegExp(`^${cleanNick}$`, 'i') }
    });
  } catch {
    return null;
  }
}

module.exports = {
  handleDarAlal3abMenu,
  handleDarAlal3abSession,
  handleActiveGameInput,
  handleGameInvitationReply,
  handleTugOfWarReply
};