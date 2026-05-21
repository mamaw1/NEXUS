const { MongoClient } = require('mongodb');

let db = null;

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('❌ متغير MONGODB_URI غير موجود في Secrets');
  const client = new MongoClient(uri);
  await client.connect();
  db = client.db('nexus');
  console.log('✅ تم الاتصال بقاعدة البيانات');
  return db;
}

function getDB() {
  if (!db) throw new Error('قاعدة البيانات غير متصلة');
  return db;
}

// ===== اللاعبون =====

async function getPlayer(fbId) {
  return await getDB().collection('players').findOne({ fbId: String(fbId) });
}

async function getPlayerByNickname(nickname) {
  return await getDB().collection('players').findOne({
    nickname: { $regex: new RegExp(`^${escapeRegex(nickname)}$`, 'i') }
  });
}

async function createPlayer(data) {
  await getDB().collection('players').insertOne(data);
}

async function updatePlayer(fbId, update) {
  await getDB().collection('players').updateOne(
    { fbId: String(fbId) },
    { $set: update }
  );
}

async function deletePlayer(fbId) {
  await getDB().collection('players').deleteOne({ fbId: String(fbId) });
}

async function getAllPlayers(kingdom) {
  const filter = kingdom ? { kingdom } : {};
  return await getDB().collection('players').find(filter).toArray();
}

// ===== التسجيل المؤقت =====

async function getTempSession(fbId) {
  return await getDB().collection('temp_sessions').findOne({ fbId: String(fbId) });
}

async function setTempSession(fbId, data) {
  await getDB().collection('temp_sessions').updateOne(
    { fbId: String(fbId) },
    { $set: { fbId: String(fbId), ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function deleteTempSession(fbId) {
  await getDB().collection('temp_sessions').deleteOne({ fbId: String(fbId) });
}

// ===== الاشعارات =====

async function addNotification(fbId, message) {
  await getDB().collection('notifications').insertOne({
    fbId: String(fbId),
    message,
    createdAt: new Date(),
    sent: false
  });
}

async function getPendingNotifications(fbId) {
  return await getDB().collection('notifications')
    .find({ fbId: String(fbId), sent: false })
    .toArray();
}

async function markNotificationsSent(fbId) {
  await getDB().collection('notifications').updateMany(
    { fbId: String(fbId), sent: false },
    { $set: { sent: true } }
  );
}

// ===== عداد الفئات =====

async function getNextClass(kingdom) {
  const order = ['فارس', 'فارس', 'ساحر', 'ساحر', 'معالج'];
  const counter = await getDB().collection('counters').findOne({ kingdom });
  const index = counter ? counter.count % 5 : 0;
  const nextClass = order[index];
  await getDB().collection('counters').updateOne(
    { kingdom },
    { $inc: { count: 1 } },
    { upsert: true }
  );
  return nextClass;
}

// ===== الحقيبة =====

async function addItemToBag(fbId, itemName, quantity) {
  const player = await getPlayer(fbId);
  if (!player) return;
  const bag = player.bag || [];
  const idx = bag.findIndex(i => i.name === itemName && i.type === 'resource');
  if (idx >= 0) {
    bag[idx].quantity += quantity;
  } else {
    bag.push({ name: itemName, quantity, type: 'resource' });
  }
  await updatePlayer(fbId, { bag });
}

async function removeItemFromBag(fbId, itemName, quantity) {
  const player = await getPlayer(fbId);
  if (!player) return false;
  const bag = player.bag || [];
  const idx = bag.findIndex(i => i.name === itemName && i.type === 'resource');
  if (idx < 0 || bag[idx].quantity < quantity) return false;
  bag[idx].quantity -= quantity;
  if (bag[idx].quantity === 0) bag.splice(idx, 1);
  await updatePlayer(fbId, { bag });
  return true;
}

// ===== جلسات تحويل الأغراض =====

async function getItemTransferSession(fbId) {
  return await getDB().collection('item_transfer_sessions').findOne({ fbId: String(fbId) });
}

async function setItemTransferSession(fbId, data) {
  await getDB().collection('item_transfer_sessions').updateOne(
    { fbId: String(fbId) },
    { $set: { fbId: String(fbId), ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function deleteItemTransferSession(fbId) {
  await getDB().collection('item_transfer_sessions').deleteOne({ fbId: String(fbId) });
}

// ===== جلسات الأدمن =====

async function getAdminSession(fbId) {
  return await getDB().collection('admin_sessions').findOne({ fbId: String(fbId) });
}

async function setAdminSession(fbId, data) {
  await getDB().collection('admin_sessions').updateOne(
    { fbId: String(fbId) },
    { $set: { fbId: String(fbId), ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function deleteAdminSession(fbId) {
  await getDB().collection('admin_sessions').deleteOne({ fbId: String(fbId) });
}

// ===== الحظر الدائم =====

async function addPermanentBan(fbId, nickname) {
  await getDB().collection('permanent_bans').updateOne(
    { fbId: String(fbId) },
    { $set: { fbId: String(fbId), nickname: nickname || fbId, bannedAt: new Date() } },
    { upsert: true }
  );
}

async function getPermanentBan(fbId) {
  return await getDB().collection('permanent_bans').findOne({ fbId: String(fbId) });
}

async function getAllPermanentBans() {
  return await getDB().collection('permanent_bans').find({}).toArray();
}

async function removePermanentBan(fbId) {
  await getDB().collection('permanent_bans').deleteOne({ fbId: String(fbId) });
}

// ===== الأوامر المعطلة =====

async function disableCommand(cmdKey) {
  await getDB().collection('disabled_commands').updateOne(
    { key: cmdKey },
    { $set: { key: cmdKey, disabledAt: new Date() } },
    { upsert: true }
  );
}

async function enableCommand(cmdKey) {
  await getDB().collection('disabled_commands').deleteOne({ key: cmdKey });
}

async function getDisabledCommands() {
  return await getDB().collection('disabled_commands').find({}).toArray();
}

async function isCommandDisabled(cmdKey) {
  const doc = await getDB().collection('disabled_commands').findOne({ key: cmdKey });
  return !!doc;
}

async function addCommandWatcher(fbId, cmdKey) {
  await getDB().collection('command_watchers').updateOne(
    { fbId: String(fbId), cmdKey },
    { $set: { fbId: String(fbId), cmdKey, addedAt: new Date() } },
    { upsert: true }
  );
}

async function getCommandWatchers(cmdKey) {
  return await getDB().collection('command_watchers').find({ cmdKey }).toArray();
}

async function clearCommandWatchers(cmdKey) {
  await getDB().collection('command_watchers').deleteMany({ cmdKey });
}

// ===== البوتات =====

async function getBots() {
  return await getDB().collection('bots').find({}).toArray();
}

async function addBot(name, cookies) {
  const result = await getDB().collection('bots').insertOne({
    name,
    cookies,
    addedAt: new Date()
  });
  return result.insertedId;
}

async function updateBotCookies(botId, cookies) {
  const { ObjectId } = require('mongodb');
  try {
    await getDB().collection('bots').updateOne(
      { _id: new ObjectId(String(botId)) },
      { $set: { cookies, status: 'active', failedAt: null } }
    );
  } catch (e) {
    console.error('updateBotCookies error:', e);
  }
}

async function getBotById(botId) {
  const { ObjectId } = require('mongodb');
  try { return await getDB().collection('bots').findOne({ _id: new ObjectId(String(botId)) }); }
  catch (e) { return null; }
}

async function updateBotName(botId, name) {
  const { ObjectId } = require('mongodb');
  try {
    await getDB().collection('bots').updateOne(
      { _id: new ObjectId(String(botId)) },
      { $set: { name } }
    );
  } catch (e) { console.error('updateBotName error:', e); }
}

async function deleteBot(botId) {
  const { ObjectId } = require('mongodb');
  try {
    await getDB().collection('bots').deleteOne({ _id: new ObjectId(String(botId)) });
  } catch (e) { console.error('deleteBot error:', e); }
}

// ===== إحصائيات الرسائل =====

async function incrementMessageCount() {
  const today = new Date().toISOString().split('T')[0];
  await getDB().collection('message_stats').updateOne(
    { date: today },
    { $inc: { count: 1 } },
    { upsert: true }
  );
}

async function getMessageStats() {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const monthAgo = new Date(now);
  monthAgo.setDate(monthAgo.getDate() - 30);

  const all = await getDB().collection('message_stats').find({}).toArray();

  let today = 0, week = 0, month = 0;
  for (const s of all) {
    const d = new Date(s.date);
    if (s.date === todayStr) today = s.count;
    if (d >= weekAgo) week += s.count;
    if (d >= monthAgo) month += s.count;
  }

  return { today, week, month };
}

// ===== إعدادات القروبات =====

async function getGroupSetting(threadId, key) {
  const doc = await getDB().collection('group_settings').findOne({ threadId: String(threadId) });
  if (!doc) return null;
  return key ? doc[key] : doc;
}

async function updateGroupSetting(threadId, update) {
  await getDB().collection('group_settings').updateOne(
    { threadId: String(threadId) },
    { $set: { threadId: String(threadId), ...update, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function getProtectionSettings(threadId) {
  return await getDB().collection('protection_settings').findOne({ threadId: String(threadId) });
}

async function saveProtectionSettings(threadId, data) {
  await getDB().collection('protection_settings').updateOne(
    { threadId: String(threadId) },
    { $set: { threadId: String(threadId), ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function getProtectedState(threadId) {
  return await getDB().collection('protected_state').findOne({ threadId: String(threadId) });
}

async function saveProtectedState(threadId, data) {
  await getDB().collection('protected_state').updateOne(
    { threadId: String(threadId) },
    { $set: { threadId: String(threadId), ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

// ===== جلسات الأوامر المعطلة =====

async function getDisabledCmdSession(fbId) {
  return await getDB().collection('disabled_cmd_sessions').findOne({ fbId: String(fbId) });
}

async function setDisabledCmdSession(fbId, data) {
  await getDB().collection('disabled_cmd_sessions').updateOne(
    { fbId: String(fbId) },
    { $set: { fbId: String(fbId), ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function deleteDisabledCmdSession(fbId) {
  await getDB().collection('disabled_cmd_sessions').deleteOne({ fbId: String(fbId) });
}

// ===== وكلاء الذكاء الاصطناعي =====

async function getAllAgents() {
  return await getDB().collection('ai_agents').find({}).toArray();
}

async function getAgentByName(name) {
  return await getDB().collection('ai_agents').findOne({
    name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') }
  });
}

async function addAgent(name, apiKey, prompt) {
  await getDB().collection('ai_agents').updateOne(
    { name },
    { $set: { name, apiKey, prompt, status: 'active', createdAt: new Date() } },
    { upsert: true }
  );
}

async function setAgentStatus(name, status) {
  await getDB().collection('ai_agents').updateOne(
    { name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') } },
    { $set: { status, statusUpdatedAt: new Date() } }
  );
}

async function updateAgent(name, data) {
  await getDB().collection('ai_agents').updateOne(
    { name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') } },
    { $set: { ...data, updatedAt: new Date() } }
  );
}

async function deleteAgent(name) {
  await getDB().collection('ai_agents').deleteOne({
    name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') }
  });
}

// ===== محادثات الوكلاء =====

async function getAgentConversation(botMessageId) {
  return await getDB().collection('agent_conversations').findOne({ botMessageId: String(botMessageId) });
}

async function saveAgentConversation(botMessageId, agentName, history, threadId) {
  await getDB().collection('agent_conversations').insertOne({
    botMessageId: String(botMessageId),
    agentName,
    history,
    threadId: String(threadId),
    lastActivity: new Date(),
    expired: false,
    createdAt: new Date()
  });
}

async function expireOldConversations(timeoutMs) {
  const cutoff = new Date(Date.now() - timeoutMs);
  const result = await getDB().collection('agent_conversations').updateMany(
    { lastActivity: { $lt: cutoff }, expired: false },
    { $set: { expired: true, history: [], expiredAt: new Date() } }
  );
  return result.modifiedCount || 0;
}

async function updateAgentConversation(botMessageId, history) {
  await getDB().collection('agent_conversations').updateOne(
    { botMessageId: String(botMessageId) },
    { $set: { history, updatedAt: new Date() } }
  );
}

async function clearAgentConversationsByName(agentName) {
  const result = await getDB().collection('agent_conversations').deleteMany({ agentName });
  return result.deletedCount || 0;
}

async function clearAllAgentConversations() {
  const result = await getDB().collection('agent_conversations').deleteMany({});
  return result.deletedCount || 0;
}

async function countAgentConversations(agentName) {
  if (agentName) return await getDB().collection('agent_conversations').countDocuments({ agentName });
  return await getDB().collection('agent_conversations').countDocuments({});
}

// ===== إعدادات البوت (bot_config) =====

async function getBotConfig(key) {
  const doc = await getDB().collection('bot_config').findOne({ key });
  return doc ? doc.value : null;
}

async function setBotConfig(key, value) {
  await getDB().collection('bot_config').updateOne(
    { key },
    { $set: { key, value, updatedAt: new Date() } },
    { upsert: true }
  );
}

// ===== جلسات الانضمام من القروبات الخارجية =====

async function getJoinSession(userId) {
  const doc = await getDB().collection('join_sessions').findOne({ userId: String(userId) });
  if (!doc) return null;
  if (doc.expiresAt && new Date() > new Date(doc.expiresAt)) {
    await deleteJoinSession(userId);
    return null;
  }
  return doc;
}

async function setJoinSession(userId, data) {
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await getDB().collection('join_sessions').updateOne(
    { userId: String(userId) },
    { $set: { userId: String(userId), ...data, expiresAt, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function deleteJoinSession(userId) {
  await getDB().collection('join_sessions').deleteOne({ userId: String(userId) });
}






// ===== جلسات النشر =====

async function getNashrSession(fbId) {
  return await getDB().collection('nashr_sessions').findOne({ fbId: String(fbId) });
}

async function setNashrSession(fbId, data) {
  await getDB().collection('nashr_sessions').updateOne(
    { fbId: String(fbId) },
    { $set: { fbId: String(fbId), ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function deleteNashrSession(fbId) {
  await getDB().collection('nashr_sessions').deleteOne({ fbId: String(fbId) });
}

// ===== المنشورات المقبولة =====

async function getNashrPost(canonicalUrl) {
  return await getDB().collection('nashr_posts').findOne({ canonicalUrl });
}

async function addNashrPost(canonicalUrl, fbId, reactions, coins) {
  await getDB().collection('nashr_posts').insertOne({
    canonicalUrl,
    fbId: String(fbId),
    reactions,
    coins,
    createdAt: new Date(),
  });
}

// ===== توكنات Apify =====

async function getApifyTokens() {
  return await getDB().collection('apify_tokens').find({}).sort({ createdAt: 1 }).toArray();
}

async function addApifyToken(token, username) {
  await getDB().collection('apify_tokens').insertOne({
    token,
    username,
    disabled: false,
    useCount: 0,
    createdAt: new Date(),
  });
}

async function removeApifyToken(id) {
  const { ObjectId } = require('mongodb');
  await getDB().collection('apify_tokens').deleteOne({ _id: new ObjectId(String(id)) });
}

async function incrementTokenUse(id) {
  const { ObjectId } = require('mongodb');
  await getDB().collection('apify_tokens').updateOne(
    { _id: new ObjectId(String(id)) },
    { $inc: { useCount: 1 }, $set: { lastUsedAt: new Date() } }
  );
}

// ===== إعدادات النشر =====

async function getNashrSettings() {
  const doc = await getDB().collection('nashr_settings').findOne({ _id: 'global' });
  return {
    minReactions : doc?.minReactions  ?? 10,
    coinsPerReact: doc?.coinsPerReact ?? 3,
  };
}

async function updateNashrSettings(data) {
  await getDB().collection('nashr_settings').updateOne(
    { _id: 'global' },
    { $set: { ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

// ===== مساعدة =====

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  connectDB,
  getDB,
  getPlayer,
  getPlayerByNickname,
  createPlayer,
  updatePlayer,
  deletePlayer,
  getAllPlayers,
  getTempSession,
  setTempSession,
  deleteTempSession,
  addNotification,
  getPendingNotifications,
  markNotificationsSent,
  getNextClass,
  addItemToBag,
  removeItemFromBag,
  getItemTransferSession,
  setItemTransferSession,
  deleteItemTransferSession,
  getAdminSession,
  setAdminSession,
  deleteAdminSession,
  addPermanentBan,
  getPermanentBan,
  getAllPermanentBans,
  removePermanentBan,
  disableCommand,
  enableCommand,
  getDisabledCommands,
  isCommandDisabled,
  addCommandWatcher,
  getCommandWatchers,
  clearCommandWatchers,
  getBots,
  addBot,
  updateBotCookies,
  getBotById,
  updateBotName,
  deleteBot,
  incrementMessageCount,
  getMessageStats,
  getGroupSetting,
  updateGroupSetting,
  getProtectionSettings,
  saveProtectionSettings,
  getProtectedState,
  saveProtectedState,
  getDisabledCmdSession,
  setDisabledCmdSession,
  deleteDisabledCmdSession,
  getAllAgents,
  getAgentByName,
  addAgent,
  updateAgent,
  deleteAgent,
  getAgentConversation,
  saveAgentConversation,
  updateAgentConversation,
  expireOldConversations,
  clearAgentConversationsByName,
  clearAllAgentConversations,
  countAgentConversations,
  setAgentStatus,
  getBotConfig,
  setBotConfig,
  getJoinSession,
  setJoinSession,
  deleteJoinSession,
  getNashrSession,
  setNashrSession,
  deleteNashrSession,
  getNashrPost,
  addNashrPost,
  getApifyTokens,
  addApifyToken,
  removeApifyToken,
  incrementTokenUse,
  getNashrSettings,
  updateNashrSettings,
};
