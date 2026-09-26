// pan_sergiy.js — Twitch чат-бот через EventSub (WebSocket) + Helix API
// Ця архітектура (замість IRC/tmi.js) потрібна, щоб Twitch показував значок "BOT" біля ніка.
//
// Встановлення: npm init -y && npm install ws dotenv
// Запуск: node pan_sergiy.js
//
// .env має містити:
// CLIENT_ID=...
// CLIENT_SECRET=...
// BOT_USER_ID=...          (ID акаунту бота)
// BROADCASTER_USER_ID=...  (ID каналу, де бот працює)

require('dotenv').config();
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const { CLIENT_ID, CLIENT_SECRET, BOT_USER_ID, BROADCASTER_USER_ID, BOT_REFRESH_TOKEN } = process.env;

let appAccessToken = null;
let botUserToken = null;
let ws = null;
const cooldowns = new Map();

function onCooldown(cmd, seconds = 5) {
  const now = Date.now();
  if (cooldowns.has(cmd) && now - cooldowns.get(cmd) < seconds * 1000) return true;
  cooldowns.set(cmd, now);
  return false;
}

// Оновлюємо BOT_REFRESH_TOKEN у файлі .env, щоб наступний запуск не використовував "згорілий" токен
function updateEnvRefreshToken(newRefreshToken) {
  const envPath = path.join(__dirname, '.env');
  try {
    let content = fs.readFileSync(envPath, 'utf-8');
    if (content.includes('BOT_REFRESH_TOKEN=')) {
      content = content.replace(/BOT_REFRESH_TOKEN=.*/g, `BOT_REFRESH_TOKEN=${newRefreshToken}`);
    } else {
      content += `\nBOT_REFRESH_TOKEN=${newRefreshToken}\n`;
    }
    fs.writeFileSync(envPath, content);
    console.log('💾 .env оновлено новим refresh_token');
  } catch (err) {
    console.error('⚠️ Не вдалось оновити .env автоматично:', err.message);
  }
}

// 0. Оновлюємо User Access Token бота через refresh_token (потрібен для підписки через WebSocket)
async function refreshBotUserToken() {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: BOT_REFRESH_TOKEN
    })
  });
  const data = await res.json();
  if (!data.access_token) {
    console.error('❌ Не вдалось оновити токен бота:', data);
    process.exit(1);
  }
  console.log('✅ User Access Token бота оновлено (перші символи):', data.access_token.slice(0, 10) + '...');
  if (data.refresh_token) {
    updateEnvRefreshToken(data.refresh_token);
  }
  return data.access_token;
}

// 1. Отримуємо App Access Token (client_credentials)
async function getAppAccessToken() {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials'
    })
  });
  const data = await res.json();
  if (!data.access_token) {
    console.error('❌ Не вдалось отримати App Access Token:', data);
    process.exit(1);
  }
  console.log('✅ App Access Token отримано');
  return data.access_token;
}

// 2. Підписуємось на подію channel.chat.message через EventSub
async function subscribeToChat(sessionId) {
  console.log('🔎 Підписуюсь з токеном (перші символи):', botUserToken ? botUserToken.slice(0, 10) + '...' : '❌ ПОРОЖНЬО!');
  const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      'Client-Id': CLIENT_ID,
      'Authorization': `Bearer ${botUserToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'channel.chat.message',
      version: '1',
      condition: {
        broadcaster_user_id: BROADCASTER_USER_ID,
        user_id: BOT_USER_ID
      },
      transport: {
        method: 'websocket',
        session_id: sessionId
      }
    })
  });
  const data = await res.json();
  if (res.status !== 202) {
    console.error('❌ Помилка підписки на чат:', data);
  } else {
    console.log('✅ Підписано на повідомлення чату');
  }
}

// 3. Відправка повідомлення в чат через Helix Send Chat Message
async function sendChatMessage(text, replyToId = null) {
  const body = {
    broadcaster_id: BROADCASTER_USER_ID,
    sender_id: BOT_USER_ID,
    message: text
  };
  if (replyToId) body.reply_parent_message_id = replyToId;

  const res = await fetch('https://api.twitch.tv/helix/chat/messages', {
    method: 'POST',
    headers: {
      'Client-Id': CLIENT_ID,
      'Authorization': `Bearer ${appAccessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (res.status !== 200) {
    console.error('❌ Помилка відправки повідомлення:', data);
  }
}

// 4. Обробка вхідного повідомлення чату
function handleChatMessage(event) {
  const user = event.chatter_user_name;
  const message = event.message.text.trim();
  const messageId = event.message_id;

  console.log(`💬 ${user}: ${message}`);

  if (event.chatter_user_id === BOT_USER_ID) return; // ігноруємо власні повідомлення

  const args = message.split(' ');
  const command = args.shift().toLowerCase();

  switch (command) {
    case '!тг':
      sendChatMessage(`📢 Наш Вусатий Telegram-канал: https://t.me/gorb_sergiy`, messageId);
      break;

    case '!інста':
      sendChatMessage(`Вусатий інстаграм: https://www.instagram.com/gorb_sergiy/`, messageId);
      break;

    case '!тікток':
      sendChatMessage(`Вусатий ТікТок: https://www.tiktok.com/@gorb_sergiy`, messageId);
      break;

    case '!ютуб':
      sendChatMessage(`Вусатий YouTube: https://www.youtube.com/@gorb_sergiy`, messageId);
      break;

    case '!айкю': {
      if (onCooldown('!айкю', 10)) return;
      const iq = Math.floor(Math.random() * 150) + 50;
      sendChatMessage(`@${user} 🧠 твій IQ сьогодні: ${iq}`, messageId);
      break;
    }

    case '!команди':
      sendChatMessage(`Доступні команди: !тг, !інста, !тікток, !ютуб, !айкю`, messageId);
      break;

    default:
      console.log(`⏭️ Команда "${command}" не розпізнана`);
  }
}

// 4.5 Автоматичні оголошення (по черзі кидає ТГ/Інсту/ТікТок/Ютуб через певний інтервал)
const announcements = [
  '📢 Наш Вусатий Telegram-канал: https://t.me/gorb_sergiy',
  '📸 Вусатий інстаграм: https://www.instagram.com/gorb_sergiy/',
  '🎵 Вусатий ТікТок: https://www.tiktok.com/@gorb_sergiy',
  '▶️ Вусатий YouTube: https://www.youtube.com/@gorb_sergiy'
];

let announcementIndex = 0;
const ANNOUNCEMENT_INTERVAL_MINUTES = 15; // онови це число, якщо треба частіше/рідше

function startAnnouncements() {
  setInterval(() => {
    sendChatMessage(announcements[announcementIndex]);
    announcementIndex = (announcementIndex + 1) % announcements.length;
  }, ANNOUNCEMENT_INTERVAL_MINUTES * 60 * 1000);
  console.log(`⏰ Автооголошення увімкнено, кожні ${ANNOUNCEMENT_INTERVAL_MINUTES} хв`);
}

// 5. Підключення до EventSub WebSocket
function connectWebSocket() {
  ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws');

  ws.on('open', () => console.log('🔌 WebSocket з\'єднання відкрито'));

  ws.on('message', async (raw) => {
    const data = JSON.parse(raw.toString());
    const type = data.metadata.message_type;

    if (type === 'session_welcome') {
      const sessionId = data.payload.session.id;
      console.log('✅ Сесію встановлено:', sessionId);
      await subscribeToChat(sessionId);
    }

    if (type === 'session_reconnect') {
      const newUrl = data.payload.session.reconnect_url;
      console.log('🔄 Twitch просить перепідключитись...');
      ws.close();
      ws = new WebSocket(newUrl);
    }

    if (type === 'notification') {
      const subType = data.payload.subscription.type;
      if (subType === 'channel.chat.message') {
        handleChatMessage(data.payload.event);
      }
    }

    if (type === 'session_keepalive') {
      // просто підтримка з'єднання, нічого робити не треба
    }
  });

  ws.on('close', () => {
    console.log('⚠️ З\'єднання закрито, перепідключення через 5 секунд...');
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (err) => console.error('❌ WebSocket помилка:', err));
}

// Старт
(async () => {
  appAccessToken = await getAppAccessToken();
  botUserToken = await refreshBotUserToken();
  connectWebSocket();
  startAnnouncements();
})();

