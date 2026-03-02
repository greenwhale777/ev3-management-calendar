/**
 * 관리 일정 스케줄러
 * 매일 09:00 KST에 D-1 알림과 당일 알림을 발송
 */

const cron = require('node-cron');
const https = require('https');
const { sendTelegramMessage, formatDayBeforeMessage, formatOnDayMessage } = require('./management-telegram');

// KST 날짜 가져오기
function getKSTDate() {
  const now = new Date();
  const kstStr = now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' });
  return new Date(kstStr);
}

// 특정 날짜가 일정일인지 판단
function isScheduleDay(schedule, targetDate) {
  const day = targetDate.getDate();
  const month = targetDate.getMonth() + 1;

  if (schedule.repeat_type === 'monthly') {
    return schedule.day === day;
  }

  if (schedule.repeat_type === 'yearly') {
    return schedule.month === month && schedule.day === day;
  }

  if (schedule.repeat_type === 'once' && schedule.specific_date) {
    const dateStr = typeof schedule.specific_date === 'string'
      ? schedule.specific_date.slice(0, 10)
      : schedule.specific_date.toISOString().slice(0, 10);
    const parts = dateStr.split('-');
    const specYear = parseInt(parts[0]);
    const specMonth = parseInt(parts[1]);
    const specDay = parseInt(parts[2]);
    return targetDate.getFullYear() === specYear
      && (targetDate.getMonth() + 1) === specMonth
      && targetDate.getDate() === specDay;
  }

  return false;
}

// EV0 통합 로그에 기록
function logToEV0(status, message, result) {
  const ev0Url = process.env.EV0_API_URL || 'https://ev0-agent-production.up.railway.app';
  const startTime = new Date().toISOString();

  const postData = JSON.stringify({
    botId: 'management-calendar',
    botName: '관리 일정 알림',
    status: status,
    startTime: startTime,
    endTime: new Date().toISOString(),
    duration: '1초',
    message: message,
    result: result || {}
  });

  const url = new URL(`${ev0Url}/api/logs`);
  const options = {
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const protocol = url.protocol === 'https:' ? https : require('http');
  const req = protocol.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log(`📊 EV0 로그 기록 완료: ${status}`);
    });
  });

  req.on('error', (e) => {
    console.error('EV0 로그 기록 실패:', e.message);
  });

  req.write(postData);
  req.end();
}

// 알림 체크 및 발송
async function checkAndNotify(pool, isTest = false) {
  const kst = getKSTDate();
  const today = new Date(kst.getFullYear(), kst.getMonth(), kst.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  console.log(`📅 알림 체크 시작 (${today.toLocaleDateString('ko-KR')}, 테스트: ${isTest})`);

  // 활성 일정 조회
  const { rows: schedules } = await pool.query(
    'SELECT * FROM management_schedules WHERE is_active = true'
  );

  const dayBeforeSchedules = [];
  const onDaySchedules = [];

  for (const schedule of schedules) {
    // D-1 알림 체크 (내일이 일정일이고 D-1 알림 활성)
    if (schedule.notify_day_before && isScheduleDay(schedule, tomorrow)) {
      dayBeforeSchedules.push(schedule);
    }
    // 당일 알림 체크 (오늘이 일정일이고 당일 알림 활성)
    if (schedule.notify_on_day && isScheduleDay(schedule, today)) {
      onDaySchedules.push(schedule);
    }
  }

  let dayBeforeCount = 0;
  let onDayCount = 0;

  // D-1 알림 발송
  if (dayBeforeSchedules.length > 0) {
    try {
      const message = formatDayBeforeMessage(dayBeforeSchedules, isTest);
      await sendTelegramMessage(message);
      dayBeforeCount = dayBeforeSchedules.length;

      // 로그 기록
      for (const s of dayBeforeSchedules) {
        await pool.query(`
          INSERT INTO management_notification_logs
            (schedule_id, notification_type, title, category, status, message)
          VALUES ($1, 'day_before', $2, $3, 'SUCCESS', $4)
        `, [s.id, s.title, s.category, isTest ? '[테스트] D-1 알림 발송' : 'D-1 알림 발송']);
      }

      console.log(`📤 D-1 알림 ${dayBeforeCount}건 발송 완료`);
    } catch (error) {
      console.error('D-1 알림 발송 실패:', error.message);
      for (const s of dayBeforeSchedules) {
        await pool.query(`
          INSERT INTO management_notification_logs
            (schedule_id, notification_type, title, category, status, error_message)
          VALUES ($1, 'day_before', $2, $3, 'ERROR', $4)
        `, [s.id, s.title, s.category, error.message]);
      }
    }
  }

  // 당일 알림 발송
  if (onDaySchedules.length > 0) {
    try {
      const message = formatOnDayMessage(onDaySchedules, isTest);
      await sendTelegramMessage(message);
      onDayCount = onDaySchedules.length;

      // 로그 기록
      for (const s of onDaySchedules) {
        await pool.query(`
          INSERT INTO management_notification_logs
            (schedule_id, notification_type, title, category, status, message)
          VALUES ($1, 'on_day', $2, $3, 'SUCCESS', $4)
        `, [s.id, s.title, s.category, isTest ? '[테스트] 당일 알림 발송' : '당일 알림 발송']);
      }

      // 일회성 일정은 당일 알림 후 비활성화
      for (const s of onDaySchedules) {
        if (s.repeat_type === 'once') {
          await pool.query(
            'UPDATE management_schedules SET is_active = false, updated_at = NOW() WHERE id = $1',
            [s.id]
          );
          console.log(`🔒 일회성 일정 비활성화: ${s.title}`);
        }
      }

      console.log(`📤 당일 알림 ${onDayCount}건 발송 완료`);
    } catch (error) {
      console.error('당일 알림 발송 실패:', error.message);
      for (const s of onDaySchedules) {
        await pool.query(`
          INSERT INTO management_notification_logs
            (schedule_id, notification_type, title, category, status, error_message)
          VALUES ($1, 'on_day', $2, $3, 'ERROR', $4)
        `, [s.id, s.title, s.category, error.message]);
      }
    }
  }

  // EV0 통합 로그 기록
  const totalCount = dayBeforeCount + onDayCount;
  if (totalCount > 0 || !isTest) {
    const logMessage = `일정 알림 발송: ${totalCount}건 (D-1: ${dayBeforeCount}건, 당일: ${onDayCount}건)`;
    logToEV0(
      totalCount > 0 ? 'SUCCESS' : 'SUCCESS',
      isTest ? `[테스트] ${logMessage}` : logMessage,
      { dayBefore: dayBeforeCount, onDay: onDayCount, total: totalCount }
    );
  }

  console.log(`✅ 알림 체크 완료 (D-1: ${dayBeforeCount}건, 당일: ${onDayCount}건)`);
  return { dayBefore: dayBeforeCount, onDay: onDayCount };
}

// 스케줄러 시작
function startScheduler(pool) {
  // 매일 09:00 KST에 실행
  cron.schedule('0 9 * * *', async () => {
    console.log('⏰ 스케줄러 실행: 일정 알림 체크');
    try {
      await checkAndNotify(pool, false);
    } catch (error) {
      console.error('스케줄러 실행 오류:', error);
      logToEV0('ERROR', `스케줄러 오류: ${error.message}`, {});
    }
  }, {
    timezone: 'Asia/Seoul'
  });

  console.log('⏰ 관리 일정 스케줄러 등록 완료 (매일 09:00 KST)');
}

module.exports = { startScheduler, checkAndNotify };
