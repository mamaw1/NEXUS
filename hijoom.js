const { getPlayer, getPlayerByNickname, updatePlayer, addNotification } = require('./database');
const { sendReply, sendMessage, kingdomNamesAr } = require('./utils');
const config = require('./config.json');

// ===== مساعدات =====

function getKingdomGroupId(kingdom) {
  if (kingdom === 'solfare') return String(config.groupes.solfare);
  if (kingdom === 'niravil') return String(config.groupes.niravil);
  if (kingdom === 'murdak')  return String(config.groupes.murdak);
  return null;
}

// تجهيز تلقائي: يجهز الدرع ذو الامتصاص الأقل
function autoEquipNextArmor(bag) {
  const armors = bag.filter(i => i.type === 'armor');
  if (armors.length === 0) return null;
  // إلغاء التجهيز الحالي
  bag.forEach(i => { if (i.type === 'armor') i.equipped = false; });
  // اختيار الدرع بأقل امتصاص
  const minArmor = armors.reduce((min, a) => (a.absorption < min.absorption ? a : min), armors[0]);
  minArmor.equipped = true;
  return minArmor;
}

// ===== أمر الهجوم =====

async function handleHijoom(api, event) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();

  // التنسيق: هجوم (اسم السلاح) على (لقب)
  const match = text.match(/^هجوم\s+(.+?)\s+على\s+(.+)$/);
  if (!match) return;

  const weaponName    = match[1].trim();
  const targetNick    = match[2].trim();

  // جلب المهاجم
  const attacker = await getPlayer(senderID);
  if (!attacker) {
    await sendReply(api,
      `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`,
      messageID, threadID);
    return;
  }

  // البحث عن السلاح في الحقيبة
  const bag = attacker.bag || [];
  const weaponIdx = bag.findIndex(i => i.type === 'weapon' && i.name === weaponName);

  if (weaponIdx === -1) {
    await sendReply(api,
      `┍━━━━[ ❌ فشل الهجوم ]━━━━◊\n` +
      `┋ ⚔️ السلاح المحدد : ${weaponName}\n` +
      `┋ 🎒 السلاح غير موجود في حقيبتك\n` +
      `┕━━━━━━━━━━━━━━━━━◊`,
      messageID, threadID);
    return;
  }

  const weapon = bag[weaponIdx];

  // البحث عن اللاعب المستهدف
  const target = await getPlayerByNickname(targetNick);
  if (!target) {
    await sendReply(api,
      `┍━━━━[ ❌ فشل الهجوم ]━━━━◊\n` +
      `┋ 🎯 اللاعب المستهدف : ${targetNick}\n` +
      `┋ ❓ اللاعب غير موجود في النظام\n` +
      `┕━━━━━━━━━━━━━━━━━◊`,
      messageID, threadID);
    return;
  }

  if (target.fbId === String(senderID)) {
    await sendReply(api,
      `┍━━━━[ ❌ فشل الهجوم ]━━━━◊\n` +
      `┋ 🚫 لا يمكنك مهاجمة نفسك!\n` +
      `┕━━━━━━━━━━━━━━━━━◊`,
      messageID, threadID);
    return;
  }

  // ===== حساب الضرر =====
  const baseDamage = weapon.damage;
  let actualDamage = baseDamage;

  // فحص الدرع المجهز للهدف
  const targetBag     = (target.bag || []).map(i => ({ ...i }));
  const armorIdx      = targetBag.findIndex(i => i.type === 'armor' && i.equipped);

  let armorName           = null;
  let armorAbsorbed       = 0;
  let armorBroken         = false;
  let armorRemainingAfter = 0;

  if (armorIdx !== -1) {
    const armor          = targetBag[armorIdx];
    armorName            = armor.name;
    const curAbsorption  = armor.absorption;

    if (curAbsorption >= baseDamage) {
      armorAbsorbed       = baseDamage;
      actualDamage        = 0;
      armor.absorption   -= baseDamage;
      armorRemainingAfter = armor.absorption;

      if (armor.absorption === 0) {
        armorBroken = true;
        targetBag.splice(armorIdx, 1);
      }
    } else {
      armorAbsorbed = curAbsorption;
      actualDamage  = baseDamage - curAbsorption;
      armorBroken   = true;
      targetBag.splice(armorIdx, 1);
    }
  }

  // ===== تقليل متانة السلاح =====
  const newAttackerBag = bag.map(i => ({ ...i }));
  newAttackerBag[weaponIdx] = { ...weapon, durability: weapon.durability - 1 };
  if (newAttackerBag[weaponIdx].durability <= 0) {
    newAttackerBag.splice(weaponIdx, 1);
  }

  // ===== تحديث HP الهدف =====
  const targetHp = target.hp ?? 1000;
  let newHp      = Math.max(0, targetHp - actualDamage);

  // ===== التجهيز التلقائي عند كسر الدرع =====
  let autoEquipInfo = null;
  let finalTargetBag = [...targetBag];

  if (armorBroken && target.autoEquip) {
    const nextArmor = autoEquipNextArmor(finalTargetBag);
    if (nextArmor) {
      autoEquipInfo = nextArmor;
    }
  }

  // ===== فحص إكسير الحياة =====
  let revivedByElixir = false;
  const targetUpdates = { bag: finalTargetBag, hp: newHp };
  if (newHp <= 0 && target.lifeElixir) {
    newHp = 300;
    revivedByElixir = true;
    targetUpdates.hp = 300;
    targetUpdates.lifeElixir = false;
  }

  // ===== حفظ التعديلات =====
  await Promise.all([
    updatePlayer(String(senderID), { bag: newAttackerBag }),
    updatePlayer(target.fbId, targetUpdates)
  ]);

  // ===== رسالة الهجوم الناجح للمهاجم =====
  const weaponDurLeft = newAttackerBag.find(i => i.type === 'weapon' && i.name === weapon.name);
  const durLine = weaponDurLeft
    ? `┋ 🔧 متانة السلاح المتبقية : ${weaponDurLeft.durability}\n`
    : `┋ 💥 السلاح تحطم بعد هذا الهجوم!\n`;

  const attackerMsg =
    `┍━━━━[ ☢️ هجوم ناجح ]━━━━◊\n` +
    `┋ ⚔️ السلاح المستخدم : ${weapon.name}\n` +
    `┋ 🎯 اللاعب المستهدف : ${target.nickname}\n` +
    `┋ 💢 الضرر الافتراضي : ${baseDamage}\n` +
    `┋ ☠️ الضرر المحقق    : ${actualDamage}\n` +
    durLine +
    `┕━━━━━━━━━━━━━━━━━◊`;

  await sendReply(api, attackerMsg, messageID, threadID);

  // ===== إشعار الهدف =====
  let shieldLine = '';
  if (armorName) {
    if (armorBroken) {
      shieldLine = `┋ 🛡️ امتصاص الدرع : ${armorName} امتص ${armorAbsorbed} ضرر ثم تحطم! 💔\n`;
    } else {
      shieldLine = `┋ 🛡️ امتصاص الدرع : ${armorName} امتص ${armorAbsorbed} ضرر (الامتصاص المتبقي: ${armorRemainingAfter})\n`;
    }
    if (autoEquipInfo) {
      shieldLine += `┋ ⚙️ تم تجهيز ${autoEquipInfo.name} تلقائياً (امتصاص: ${autoEquipInfo.absorption})\n`;
    }
  }

  const attackerKingdomAr = kingdomNamesAr[attacker.kingdom] || attacker.kingdom;

  const elixirLine = revivedByElixir
    ? `┋ 💎 إكسير الحياة أعادك للحياة بـ 300 HP!\n`
    : '';

  const targetNotif =
    `┍━━━━[ ⚠️ تتعرض لهجوم 🚨 ]━━━━◊\n` +
    `┋ ⚔️ المهاجم  : ${attacker.nickname}\n` +
    `┋ 🏰 مملكته   : ${attackerKingdomAr}\n` +
    shieldLine +
    `┋ ☠️ الضرر الصافي عليك : ${actualDamage}\n` +
    elixirLine +
    `┕━━━━━━━━━━━━━━━━━━━━◊`;

  const isSameKingdom = attacker.kingdom === target.kingdom;

  if (isSameKingdom) {
    // نفس المملكة: إشعار للهدف فقط
    await addNotification(target.fbId, targetNotif);
  } else {
    // مملكة مختلفة: إشعار للهدف + تنبيه في قروب مملكته
    await addNotification(target.fbId, targetNotif);

    const targetGroupId = getKingdomGroupId(target.kingdom);
    if (targetGroupId) {
      const groupAlert =
        `◊━━━━━━━━━━━━━━━━━━━◊\n` +
        `🚨━𓊈 ☄تنبيه هجوم خارجي ☄ 𓊉━🚨\n` +
        `◊━━━━━━━━━━━━━━━━━━━◊\n` +
        `❰ المهاجم 🗡️ ❱ ⟸ ${attacker.nickname}\n` +
        `❰ مملكته 🏰 ❱  ⟸ ${attackerKingdomAr}\n` +
        `◊━━━━━━━━━━━━━━━━━━━◊\n` +
        `❰ المستهدف ⊹ ❱ ⟸ ${target.nickname}\n` +
        `◊━━━━━━━━━━━━━━━━━━━◊`;

      await sendMessage(api, groupAlert, targetGroupId);
    }
  }
}

// ===== أمر تجهيز الدرع =====

async function handleTajhizDar3(api, event) {
  const { threadID, senderID, messageID } = event;

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api,
      `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`,
      messageID, threadID);
    return;
  }

  const bag    = player.bag || [];
  const armors = bag.filter(i => i.type === 'armor');

  if (armors.length === 0) {
    await sendReply(api,
      `❰━━━━═ الدروع المتاحة ═━━━━❱\n` +
      `⌖ لا يوجد دروع في حقيبتك\n` +
      `❰━━━━━══ 🛡️ ══━━━━━❱`,
      messageID, threadID);
    return;
  }

  const autoStatus = player.autoEquip ? '🟢' : '🔴';

  const armorList = armors.map((a, idx) => {
    const mark = a.equipped ? ' ⧨' : '';
    return `${idx + 1} 》 ${a.name} (امتصاص: ${a.absorption})${mark}`;
  }).join('\n');

  const msg =
    `❰━━━━═ الدروع المتاحة ═━━━━❱\n` +
    `${armorList}\n` +
    `⌖━━━━━━━━━━━━━━━⌖\n` +
    `❖ لتجهيز الدرع رد على هذه الرسالة برقمه\n` +
    `❖ لتفعيل او الغاء تفعيل التجهيز التلقائي اكتب 《التجهيز التلقائي》\n` +
    `❖ التجهيز التلقائي ${autoStatus}\n` +
    `❰━━━━━══ 🛡️ ══━━━━━❱`;

  await sendReply(api, msg, messageID, threadID);
}

// ===== معالجة الرد بالرقم لتجهيز الدرع =====

async function handleArmorEquipReply(api, event, num) {
  const { threadID, senderID, messageID } = event;

  const player = await getPlayer(senderID);
  if (!player) return;

  const bag    = player.bag || [];
  const armors = bag.filter(i => i.type === 'armor');

  if (num < 1 || num > armors.length) {
    await sendReply(api,
      `❌ رقم غير صحيح، الرجاء اختيار رقم بين 1 و ${armors.length}`,
      messageID, threadID);
    return;
  }

  const selected = armors[num - 1];

  // إلغاء جميع التجهيزات السابقة
  bag.forEach(i => { if (i.type === 'armor') i.equipped = false; });

  // تجهيز الدرع المختار
  const targetIdx = bag.findIndex(i => i.type === 'armor' && i.name === selected.name && i.absorption === selected.absorption);
  if (targetIdx !== -1) {
    bag[targetIdx].equipped = true;
  }

  await updatePlayer(String(senderID), { bag });

  await sendReply(api,
    `✅ تم تجهيز درع 《${selected.name}》 بنجاح!\n🛡️ الامتصاص : ${selected.absorption}`,
    messageID, threadID);
}

// ===== تبديل التجهيز التلقائي =====

async function handleAutoEquipToggle(api, event) {
  const { threadID, senderID, messageID } = event;

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api,
      `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`,
      messageID, threadID);
    return;
  }

  const newState   = !player.autoEquip;
  const statusIcon = newState ? '🟢' : '🔴';
  const statusText = newState ? 'مفعل' : 'معطل';

  await updatePlayer(String(senderID), { autoEquip: newState });

  await sendReply(api,
    `⚙️ التجهيز التلقائي للدرع\n` +
    `━━━━━━━━━━━━━━━\n` +
    `الحالة : ${statusIcon} ${statusText}\n` +
    (newState
      ? `✅ عند تحطم الدرع المجهز سيتم تجهيز الدرع الأقل امتصاصاً تلقائياً`
      : `❌ لن يتم التجهيز التلقائي عند تحطم الدرع`),
    messageID, threadID);
}

module.exports = {
  handleHijoom,
  handleTajhizDar3,
  handleArmorEquipReply,
  handleAutoEquipToggle
};
