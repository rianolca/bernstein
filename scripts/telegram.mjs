// Kleine Helfer für die Telegram-Bot-API.
// Token und Chat-ID kommen aus den GitHub-Secrets (Umgebungsvariablen).

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export const telegramBereit = () => Boolean(TOKEN && CHAT_ID);

async function api(methode, daten) {
  const antwort = await fetch(`https://api.telegram.org/bot${TOKEN}/${methode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(daten || {}),
  });
  const json = await antwort.json().catch(() => ({}));
  if (!json.ok) throw new Error(`Telegram ${methode} fehlgeschlagen: ${json.description || antwort.status}`);
  return json.result;
}

export async function sendeNachricht(text) {
  if (!telegramBereit()) {
    console.log('Telegram nicht eingerichtet (Secrets fehlen) – Nachricht nur im Log:\n' + text);
    return false;
  }
  await api('sendMessage', { chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true });
  return true;
}

// Zeigt im Log, welche Chats dem Bot zuletzt geschrieben haben.
export async function zeigeChatIds() {
  if (!TOKEN) {
    console.log('TELEGRAM_BOT_TOKEN fehlt – bitte zuerst das Secret anlegen.');
    return;
  }
  const updates = await api('getUpdates', {});
  const chats = new Map();
  for (const u of updates) {
    const chat = (u.message || u.channel_post || u.my_chat_member || {}).chat;
    if (chat) chats.set(chat.id, chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username);
  }
  if (!chats.size) {
    console.log('Keine Nachrichten gefunden. Schreib deinem Bot in Telegram z. B. "Hallo" und starte den Job danach noch einmal.');
    return;
  }
  console.log('Gefundene Chats – trage die Zahl als Secret TELEGRAM_CHAT_ID ein:');
  for (const [id, name] of chats) console.log(`  ${id}  (${name})`);
}
