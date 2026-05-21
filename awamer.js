const { getKingdomByThreadId } = require('./utils');
const { getPlayer } = require('./database');

const PAGE_SIZE = 12;

const ALL_COMMANDS = [
  '➤  ملفي ┇عرض تفاصيل اللاعب',
  '➤ الحقيبة┇عرض حقيبة الاغراض والموارد',
  '➤ تحويل (عدد) كوينز الى (لقب) ┇ لتحويل الكوينز للاعب اخر',
  '➤ ارسال (اسم الغرض ) الى (لقب) ┇ ارسال غرض من الحقيبة للاعب اخر',
  { text: '➤ حفر ┇التنقيب عن الموارد', kingdoms: ['murdak'] },
  { text: '➤ جمع ┇البحث عن الموارد', kingdoms: ['niravil'] },
  { text: '➤ صيد ┇ صيد الموارد', kingdoms: ['solfare'] },
  '➤ تصنيع┇صنع الاسلحة والدروع والمستلزمات والمواد',
  '➤ المتجر┇متجر نيكسوس الرسمي',
  '➤ السوق  ┇ اشتري وبع وتبادل الموارد والاغراض مع اللاعبين الاخرين',
  '➤ هجوم (اسم السلاح) على (لقب)┇لاستعمال اي سلاح على شخص اخر',
  '➤وضعية القتال ┇الانتقال لوضع القتال',
  '➤ تجهيز الدرع ┇ لتجهيز الدرع من اجل حمايتك تلقائيا اذا تم الهجوم عليك',
  '➤ استعمال (اسم الغرض ) ┇ لاستعمال المواد او الاغراض القابلة للاستعمال',
  '➤ كوينز النشر┇ربح الكوينز من نشر المنشورات',
  '➤ تقرير┇تقرير عن اقتصاد الممالك الثلاثة واغنى اللاعبين',
  '➤البنك┇استثمر او اقترض او خزن كوينزك لدى بنك نيكسوس',
  '➤ مسابقة الدعوات ┇مسابقة يومية وجوائز للاعبين الاكثر دعوة',
  '➤مسابقة النشر ┇مسابقة يومية وجوائز للاعبين الاكثر نشرا',
  '➤ بيت الالعاب ┇ العاب جماعية وفردية ممتعة',
  '➤ الاعدادات ┇ ضبط إعدادت اخرى',
  '➤ ايجنت ┇ تحدث مع الذكاء الاصطناعي المتاح',
];

function getFilteredCommands(kingdom) {
  return ALL_COMMANDS
    .filter(cmd => {
      if (typeof cmd === 'string') return true;
      return cmd.kingdoms.includes(kingdom);
    })
    .map(cmd => (typeof cmd === 'string' ? cmd : cmd.text));
}

async function sendCommandsPage(api, event, pageNum = 1) {
  const { threadID, senderID, messageID } = event;
  const kingdom = getKingdomByThreadId(threadID);
  if (!kingdom) return;

  const player = await getPlayer(senderID);
  if (!player) {
    await new Promise((resolve) => {
      api.sendMessage(
        { body: `𓆫─━━࿇━━━──━━━࿇━━─𓆫\n              『 تنبيه ⚠ 』\n\nيجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام\n\n     𓆫─━━࿇━━━──━━━࿇━━─𓆫` },
        threadID, () => resolve(), messageID
      );
    });
    return;
  }

  const cmds = getFilteredCommands(kingdom);
  const totalPages = Math.ceil(cmds.length / PAGE_SIZE);
  const page = Math.max(1, Math.min(pageNum, totalPages));
  const start = (page - 1) * PAGE_SIZE;
  const pageCmds = cmds.slice(start, start + PAGE_SIZE);

  const body =
    `╗═════━━━❖━━━═════╔\n` +
    ` ⊱                   الاوامر.                     ⊰  \n` +
    `╝═════━━━❖━━━═════╚\n` +
    pageCmds.join('\n') +
    `\n━════════════════━\n` +
    `● الصفحة ${page}/${totalPages}\n` +
    `● للانتقال لصفحة اخرى رد على هذه الرسالة برقم الصفحة\n` +
    `━════════════════━`;

  await new Promise((resolve) => {
    api.sendMessage({ body }, threadID, () => resolve(), messageID);
  });
}

async function handleAwamer(api, event) {
  await sendCommandsPage(api, event, 1);
}

async function handleAwamerPage(api, event, pageNum) {
  await sendCommandsPage(api, event, pageNum);
}

module.exports = { handleAwamer, handleAwamerPage };
