/**
 * 텔레그램 알림 모듈
 */

const https = require('https');

const BOT_TOKEN = process.env.MANAGEMENT_TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.MANAGEMENT_TELEGRAM_CHAT_ID || '35391597';

// 카테고리 한글 매핑
const CATEGORY_MAP = {
  tax: '💰 세금',
  salary: '💵 급여',
  insurance: '🛡️ 보험',
  contract: '📝 계약',
  etc: '📋 기타'
};

// 반복 설명 텍스트
function formatRepeat(schedule) {
  if (schedule.repeat_type === 'monthly') return `매월 ${schedule.day}일`;
  if (schedule.repeat_type === 'yearly') return `매년 ${schedule.month}/${schedule.day}`;
  if (schedule.repeat_type === 'once') {
    const dateStr = typeof schedule.specific_date === 'string'
      ? schedule.specific_date.slice(0, 10)
      : schedule.specific_date.toISOString().slice(0, 10);
    return `${dateStr} (1회)`;
  }
  return '-';
}

// D-1 알림 메시지 포맷
function formatDayBeforeMessage(schedules, isTest) {
  const prefix = isTest ? '[테스트] ' : '';
  let msg = `📅 <b>${prefix}[D-1] 내일 일정 알림</b>\n━━━━━━━━━━━━━━\n`;

  for (const s of schedules) {
    msg += `\n📌 <b>${s.title}</b>\n`;
    msg += `📅 ${formatRepeat(s)} (내일)\n`;
    msg += `🏷️ ${CATEGORY_MAP[s.category] || CATEGORY_MAP.etc}\n`;
    if (s.description) {
      msg += `📝 ${s.description}\n`;
    }
    msg += `━━━━━━━━━━━━━━\n`;
  }

  return msg;
}

// 당일 알림 메시지 포맷
function formatOnDayMessage(schedules, isTest) {
  const prefix = isTest ? '[테스트] ' : '';
  let msg = `🔔 <b>${prefix}[오늘] 일정 알림</b>\n━━━━━━━━━━━━━━\n`;

  for (const s of schedules) {
    msg += `\n📌 <b>${s.title}</b>\n`;
    msg += `📅 ${formatRepeat(s)} (오늘)\n`;
    msg += `🏷️ ${CATEGORY_MAP[s.category] || CATEGORY_MAP.etc}\n`;
    if (s.description) {
      msg += `📝 ${s.description}\n`;
    }
    msg += `━━━━━━━━━━━━━━\n`;
  }

  msg += `\n⚠️ 오늘 처리해야 할 일정입니다!`;
  return msg;
}

// 텔레그램 메시지 발송
function sendTelegramMessage(text) {
  return new Promise((resolve, reject) => {
    if (!BOT_TOKEN) {
      return reject(new Error('MANAGEMENT_TELEGRAM_BOT_TOKEN이 설정되지 않았습니다'));
    }

    const postData = JSON.stringify({
      chat_id: CHAT_ID,
      text: text,
      parse_mode: 'HTML'
    });

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.ok) {
            resolve(result);
          } else {
            reject(new Error(`텔레그램 API 오류: ${result.description}`));
          }
        } catch (e) {
          reject(new Error(`응답 파싱 오류: ${data}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error(`텔레그램 요청 실패: ${e.message}`));
    });

    req.write(postData);
    req.end();
  });
}

module.exports = {
  CATEGORY_MAP,
  formatDayBeforeMessage,
  formatOnDayMessage,
  sendTelegramMessage
};
