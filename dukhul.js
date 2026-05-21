const config = require('./config.json');
const { kingdomNames, kingdomNamesAr, getKingdomByThreadId, sendMessage } = require('./utils');

function getBotIdFromConfig() {
  const cookie = config.cookies.find(c => c.key === 'c_user');
  return cookie ? String(cookie.value) : null;
}

async function handleBotJoin(api, event) {
  const { threadID, participantIDs } = event;
  const botId = getBotIdFromConfig();

  console.log('📥 log:subscribe | threadID:', threadID, '| participantIDs:', participantIDs, '| botId:', botId);

  // تحقق إذا البوت هو من انضم
  if (!botId || (!participantIDs.includes(botId) && !participantIDs.includes(Number(botId)))) {
    console.log('⏩ البوت لم ينضم، تم التجاهل');
    return;
  }

  const kingdom = getKingdomByThreadId(threadID);
  console.log('🏰 kingdom:', kingdom);
  if (!kingdom) return;

  // تغيير كنية البوت
  try {
    await changeBotNickname(api, threadID, botId);
  } catch (e) {
    console.error('خطأ في تغيير الكنية:', e);
  }

  // إرسال رسالة الترحيب
  const welcomeMsg = buildWelcomeMessage(kingdom);
  await sendMessage(api, welcomeMsg, threadID);
}

function buildWelcomeMessage(kingdom) {
  const name = kingdomNames[kingdom];
  const nameAr = kingdomNamesAr[kingdom];

  return `◆━━━━━━━▷ ✦ ◁━━━━━━━◆
❖| 𝑵𝑬𝑿𝑼𝑺 𝑩𝑶𝑻 ┇بوت نضام نيكسوس
❖|    ${name}    ┇    مملكة ${nameAr} 
◆━━━━━━━▷ ✦ ◁━━━━━━━◆`;
}

async function changeBotNickname(api, threadID, botId) {
  return new Promise((resolve, reject) => {
    api.changeNickname(
      '𖣘┇𝑵𝑬𝑿𝑼𝑺 𝑩𝑶𝑻 ┇𖣘',
      threadID,
      String(botId),
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}


// تغيير كنية لاعب معين
async function changePlayerNickname(api, threadID, playerFbId, nickname, rank, playerClass) {
  const { generateNickname } = require('./utils');
  const newNickname = generateNickname(nickname, rank, playerClass);
  return new Promise((resolve, reject) => {
    api.changeNickname(newNickname, threadID, String(playerFbId), (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

module.exports = {
  handleBotJoin,
  changeBotNickname,
  changePlayerNickname
};
