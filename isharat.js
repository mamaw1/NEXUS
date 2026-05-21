const {
  getPendingNotifications,
  markNotificationsSent
} = require('./database');

const { sendReply } = require('./utils');

function formatTimeAgo(date) {
  const diff = Math.max(0, Date.now() - new Date(date).getTime());
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `قبل ${seconds} ثانية 🕐`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `قبل ${minutes} دقيقة 🕐`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `قبل ${hours} ساعة 🕐`;
  const days = Math.floor(hours / 24);
  return `قبل ${days} يوم 🕐`;
}

async function checkAndSendNotifications(api, event) {
  const { senderID, threadID, messageID } = event;

  const notifications = await getPendingNotifications(senderID);
  if (!notifications || notifications.length === 0) return;

  await markNotificationsSent(senderID);

  for (const notif of notifications) {
    const timeAgo = notif.createdAt ? formatTimeAgo(notif.createdAt) : '';
    const msg = `╮──────────────⟢ـ\n┆˼🔔˹┊ اشعارات جديدة ↶\n╯──────────────⟢ـ\n${notif.message}\n${timeAgo}`;
    await sendReply(api, msg, messageID, threadID);
  }
}

module.exports = { checkAndSendNotifications };
