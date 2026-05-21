const config = require('./config.json');

// الحرف الخفي لتنسيق الرسائل
const H = '\u061C';

// رموز الفئات
const classSymbols = {
  'فارس': '✹',
  'معالج': '⚘',
  'ساحر': '𖤝'
};

// أسماء الممالك
const kingdomNames = {
  solfare: '𝑺𝑶𝑳𝑽𝑨𝑹𝑨',
  niravil: '𝑵𝑰𝑹𝑨𝑽𝑰𝑳',
  murdak: '𝑴𝑶𝑹𝑫𝑨𝑲'
};

const kingdomNamesAr = {
  solfare: 'سولفارا',
  niravil: 'نيرافيل',
  murdak: 'مورداك'
};

// تحديد المملكة من معرف المجموعة
function getKingdomByThreadId(threadId) {
  const id = String(threadId);
  if (id === config.groupes.solfare) return 'solfare';
  if (id === config.groupes.niravil) return 'niravil';
  if (id === config.groupes.murdak) return 'murdak';
  return null;
}

// توليد الكنية
function generateNickname(nickname, rank, playerClass) {
  const symbol = classSymbols[playerClass] || '✹';
  return `╮ ⟦ ${nickname} ⟧⤷ ${rank} ⌈${symbol}⌋ ╭`;
}

// استخراج الايدي من رابط فيسبوك
function extractFbId(text) {
  // رابط مباشر بالايدي
  const idMatch = text.match(/profile\.php\?id=(\d+)/);
  if (idMatch) return idMatch[1];

  // رابط /groups/ وما شابه
  const groupMatch = text.match(/facebook\.com\/groups\/(\d+)/);
  if (groupMatch) return groupMatch[1];

  // رابط بالمعرف الرقمي في نهاية الرابط
  const numericEnd = text.match(/facebook\.com\/(?:[^\/]+\/)*(\d{10,})/);
  if (numericEnd) return numericEnd[1];

  // رقم مباشر
  const directNum = text.match(/\b(\d{10,})\b/);
  if (directNum) return directNum[1];

  return null;
}

// استخراج اليوزرنيم من رابط فيسبوك
function extractUsername(text) {
  const match = text.match(/facebook\.com\/([a-zA-Z0-9._]+)/);
  if (match && match[1] !== 'profile.php' && match[1] !== 'groups') {
    return match[1];
  }
  return null;
}

// رسم شريط HP/EP
function drawBar(value, max = 1000) {
  const filled = Math.floor(value / 100);
  const empty = Math.floor(max / 100) - filled;
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty));
}

// دالة إرسال رسالة مع الرد على رسالة معينة
function sendReply(api, message, messageId, threadId) {
  return new Promise((resolve, reject) => {
    const msg = {
      body: H + message,
      mentions: []
    };
    if (messageId) {
      api.sendMessage(msg, threadId, (err, info) => {
        if (err) return reject(err);
        // الرد على الرسالة
        try {
          api.setMessageReaction('', messageId, threadId, () => {});
        } catch (e) {}
        resolve(info);
      }, messageId);
    } else {
      api.sendMessage(msg, threadId, (err, info) => {
        if (err) return reject(err);
        resolve(info);
      });
    }
  });
}

// دالة إرسال بسيطة بدون رد
function sendMessage(api, message, threadId) {
  return new Promise((resolve, reject) => {
    api.sendMessage({ body: H + message }, threadId, (err, info) => {
      if (err) return reject(err);
      resolve(info);
    });
  });
}

module.exports = {
  H,
  classSymbols,
  kingdomNames,
  kingdomNamesAr,
  getKingdomByThreadId,
  generateNickname,
  extractFbId,
  extractUsername,
  drawBar,
  sendReply,
  sendMessage
};
