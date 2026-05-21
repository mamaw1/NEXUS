const https = require('https');
const fs = require('fs');
const path = require('path');
const { sendMessage } = require('./utils');
const {
  getAllAgents,
  getAgentByName,
  getAgentConversation,
  saveAgentConversation,
  updateAgentConversation,
  expireOldConversations,
  setAgentStatus
} = require('./database');

// قراءة الإعدادات من config.json ديناميكياً
function getConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch (_) { return {}; }
}

function getMaxHistory() {
  const limit = parseInt(getConfig().memoryLimit);
  return (!isNaN(limit) && limit > 0) ? limit * 2 : 20;
}

function getConversationTimeout() {
  const t = parseInt(getConfig().conversationTimeout);
  return (!isNaN(t) && t > 0) ? t * 60 * 1000 : 20 * 60 * 1000; // بالميلي ثانية
}

// ===== تنظيف المحادثات المنتهية الصلاحية =====
function startConversationCleanup() {
  setInterval(async () => {
    try {
      const expired = await expireOldConversations(getConversationTimeout());
      if (expired > 0) console.log(`[ذاكرة] انتهت صلاحية ${expired} محادثة`);
    } catch (e) { console.error('[ذاكرة] خطأ في التنظيف:', e); }
  }, 60 * 1000); // كل دقيقة
}

// ===== استدعاء Groq API =====
function callGroq(apiKey, messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: 1024,
      temperature: 0.8
    });

    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.choices && parsed.choices[0]) {
            resolve(parsed.choices[0].message.content);
          } else {
            reject(new Error(parsed.error ? parsed.error.message : 'استجابة غير متوقعة'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ===== عرض قائمة الوكلاء =====
async function handleAgentList(api, event) {
  const { threadID, messageID } = event;
  const agents = await getAllAgents();

  if (!agents || agents.length === 0) {
    await sendMessage(api,
      `╮───∙⋆⋅「 ايجنت 」\n│\n│ › لا يوجد ذكاء اصطناعي متاح حالياً\n│ › تواصل مع الادمن لإضافة وكيل\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }

  let msg = `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n`;
  msg += `     ✦  مركز الذكاء الاصطناعي  ✦\n`;
  msg += `╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n`;
  msg += `╮───∙⋆⋅「 الوكلاء المتاحون 」\n`;
  agents.forEach((a, i) => {
    const dot = (a.status === 'inactive') ? '🔴' : '🟢';
    msg += `│ ${i + 1}. ${dot} ${a.name}\n`;
  });
  msg += `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n`;
  msg += `╮───∙⋆⋅「 كيفية الاستخدام 」\n`;
  msg += `│ › اكتب اسم الوكيل لبدء المحادثة\n`;
  msg += `│ › رد على رسائله لمواصلة الحوار\n`;
  msg += `╯───────∙⋆⋅ ※ ⋅⋆∙`;

  await sendMessage(api, msg, threadID);
}

// ===== بدء محادثة مع وكيل =====
async function handleAgentStart(api, event, agentName) {
  const { threadID, messageID } = event;
  const agent = await getAgentByName(agentName);
  if (!agent) return false;

  const welcomeMsg =
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n` +
    `   ✦  ${agent.name}  ✦\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `مرحباً، أنا ${agent.name} 👋\n` +
    `لتتحدث معي، رد على هذه الرسالة\n\n` +
    `╮───∙⋆⋅「 ملاحظة 」\n` +
    `│ › يمكن للجميع الانضمام للحوار\n` +
    `│ › بالرد على أي رسالة مني\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙`;

  const info = await sendMessage(api, welcomeMsg, threadID);
  if (info && info.messageID) {
    await saveAgentConversation(info.messageID, agent.name, [], threadID);
  }

  return true;
}

// ===== جلب اسم المستخدم =====
function getUserInfo(api, userId) {
  return new Promise((resolve) => {
    try {
      api.getUserInfo(String(userId), (err, data) => {
        if (err || !data || !data[userId]) return resolve(null);
        const user = data[userId];
        resolve({ name: user.name || user.fullName || null, id: String(userId) });
      });
    } catch (e) {
      resolve(null);
    }
  });
}

// ===== تفاعل بإيموجي =====
function setReaction(api, emoji, messageID, threadID) {
  return new Promise((resolve) => {
    try {
      api.setMessageReaction(emoji, messageID, threadID, () => resolve(), true);
    } catch (e) {
      resolve();
    }
  });
}

// ===== معالجة الرد على رسالة الوكيل =====
async function handleAgentReply(api, event) {
  const { threadID, senderID, body, messageReply, messageID } = event;
  if (!messageReply || !messageReply.messageID) return false;

  const conv = await getAgentConversation(messageReply.messageID);
  if (!conv) return false;

  // محادثة منتهية الصلاحية
  if (conv.expired) {
    await sendMessage(api,
      `╮───∙⋆⋅「 ${conv.agentName} 」\n│\n│ › ⏳ انتهت هذه المحادثة\n│ › مرت أكثر من ${Math.round(getConversationTimeout() / 60000)} دقيقة بدون نشاط\n│\n│ › ابدأ محادثة جديدة بكتابة اسم الوكيل\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return true;
  }

  const userText = (body || '').trim();
  if (!userText) return false;

  const agent = await getAgentByName(conv.agentName);
  if (!agent) return false;

  // تفاعل "جاري المعالجة"
  await setReaction(api, '✴️', messageID, threadID);

  // جلب معلومات المستخدم
  const userInfo = await getUserInfo(api, senderID);
  const userName = userInfo && userInfo.name ? userInfo.name : 'مستخدم مجهول';
  const userId = userInfo ? userInfo.id : String(senderID);

  const history = conv.history || [];

  // رسالة السياق: من يتحدث الآن (تُضاف للطلب فقط ولا تُحفظ في التاريخ)
  const contextNote = `[معلومة تلقائية: الشخص الذي يكتب لك الآن اسمه "${userName}" وايدي حسابه هو "${userId}". استخدم هذه المعلومة عند الحاجة فقط ولا تذكرها تلقائياً في كل رد.]`;

  const messages = [
    { role: 'system', content: agent.prompt },
    ...history,
    { role: 'user', content: `${contextNote}\n\n${userText}` }
  ];

  let reply;
  try {
    reply = await callGroq(agent.apiKey, messages);
    // الرد نجح — تأكد أن الحالة خضراء
    setAgentStatus(agent.name, 'active').catch(() => {});
  } catch (e) {
    console.error('Groq error:', e);
    await setReaction(api, '❌', messageID, threadID);

    const errMsg = (e && e.message) ? e.message : '';
    let lines = [];
    let markInactive = false;

    if (/rate limit/i.test(errMsg)) {
      markInactive = true;
      // نوع الحد
      let limitType = 'الاستخدام';
      if (/tokens per day|TPD/i.test(errMsg)) limitType = 'التوكنز اليومية';
      else if (/tokens per minute|TPM/i.test(errMsg)) limitType = 'التوكنز في الدقيقة';
      else if (/requests per minute|RPM/i.test(errMsg)) limitType = 'الطلبات في الدقيقة';
      else if (/requests per day|RPD/i.test(errMsg)) limitType = 'الطلبات اليومية';

      lines.push(`› ⛔ وصل الحد المسموح به لـ ${limitType}`);

      // الأرقام
      const limitMatch = errMsg.match(/Limit (\d+)/i);
      const usedMatch  = errMsg.match(/Used (\d+)/i);
      const reqMatch   = errMsg.match(/Requested (\d+)/i);
      if (limitMatch) lines.push(`› الحد الكلي : ${Number(limitMatch[1]).toLocaleString()}`);
      if (usedMatch)  lines.push(`› المستخدم  : ${Number(usedMatch[1]).toLocaleString()}`);
      if (reqMatch)   lines.push(`› المطلوب   : ${Number(reqMatch[1]).toLocaleString()}`);

      // وقت الانتظار
      const waitMatch = errMsg.match(/try again in ([^\.\n]+)/i);
      if (waitMatch) lines.push(`› انتظر     : ${waitMatch[1].trim()}`);
    } else if (/invalid.*api.*key|api key/i.test(errMsg)) {
      markInactive = true;
      lines.push('› مفتاح API غير صالح');
      lines.push('› تواصل مع الادمن لتصحيح المفتاح');
    } else if (/timeout|ETIMEDOUT|ECONNRESET/i.test(errMsg)) {
      lines.push('› انتهت مهلة الاتصال بالخادم');
      lines.push('› حاول مرة أخرى بعد لحظات');
    } else {
      lines.push('› حدث خطأ غير متوقع');
      lines.push('› حاول مرة أخرى لاحقاً');
    }

    if (markInactive) {
      setAgentStatus(agent.name, 'inactive').catch(() => {});
    }

    await sendMessage(api,
      `╮───∙⋆⋅「 ${agent.name} 」\n│\n` +
      lines.map(l => `│ ${l}`).join('\n') +
      `\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return true;
  }

  // حفظ الرسالة الأصلية فقط (بدون معلومات السياق)
  history.push({ role: 'user', content: userText });
  history.push({ role: 'assistant', content: reply });

  // تقليص الذاكرة إذا تجاوزت الحد المحدد
  const maxHistory = getMaxHistory();
  while (history.length > maxHistory) history.splice(0, 2);

  // تفاعل "تم الانتهاء"
  await setReaction(api, '✅️', messageID, threadID);

  const replyMsg =
    `╮───∙⋆⋅「 ${agent.name} 」\n│\n` +
    reply.split('\n').map(l => `│ ${l}`).join('\n') +
    `\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙\n` +
    `‎⌁ رد على هذه الرسالة لمواصلة الحوار`;

  const info = await sendMessage(api, replyMsg, threadID);

  if (info && info.messageID) {
    await saveAgentConversation(info.messageID, agent.name, history, threadID);
  }

  return true;
}

module.exports = { handleAgentList, handleAgentStart, handleAgentReply, startConversationCleanup };
