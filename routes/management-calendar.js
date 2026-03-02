/**
 * 관리 일정 API 라우트
 */

const express = require('express');

// KST 날짜 가져오기
function getKSTDate() {
  const now = new Date();
  const kstStr = now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' });
  return new Date(kstStr);
}

// 일정의 다음 도래일 계산
function getNextDate(schedule) {
  const kst = getKSTDate();
  const today = new Date(kst.getFullYear(), kst.getMonth(), kst.getDate());

  if (schedule.repeat_type === 'monthly') {
    let nextDate = new Date(today.getFullYear(), today.getMonth(), schedule.day);
    if (nextDate < today) {
      nextDate = new Date(today.getFullYear(), today.getMonth() + 1, schedule.day);
    }
    return nextDate;
  }

  if (schedule.repeat_type === 'yearly') {
    let nextDate = new Date(today.getFullYear(), schedule.month - 1, schedule.day);
    if (nextDate < today) {
      nextDate = new Date(today.getFullYear() + 1, schedule.month - 1, schedule.day);
    }
    return nextDate;
  }

  if (schedule.repeat_type === 'once' && schedule.specific_date) {
    const dateStr = typeof schedule.specific_date === 'string'
      ? schedule.specific_date.slice(0, 10)
      : schedule.specific_date.toISOString().slice(0, 10);
    const parts = dateStr.split('-');
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  }

  return null;
}

// 날짜를 YYYY-MM-DD 형식으로
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = function (pool) {
  const router = express.Router();

  // GET / - 전체 일정 목록 조회
  router.get('/', async (req, res) => {
    try {
      const { category, is_active } = req.query;
      let query = 'SELECT * FROM management_schedules';
      const conditions = [];
      const params = [];

      if (category) {
        params.push(category);
        conditions.push(`category = $${params.length}`);
      }
      if (is_active !== undefined) {
        params.push(is_active === 'true');
        conditions.push(`is_active = $${params.length}`);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      query += ' ORDER BY created_at DESC';

      const { rows } = await pool.query(query, params);
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error('일정 목록 조회 오류:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /upcoming - 향후 7일 이내 다가오는 일정
  router.get('/upcoming', async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM management_schedules WHERE is_active = true'
      );

      const kst = getKSTDate();
      const today = new Date(kst.getFullYear(), kst.getMonth(), kst.getDate());
      const sevenDaysLater = new Date(today);
      sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

      const upcoming = [];
      for (const schedule of rows) {
        const nextDate = getNextDate(schedule);
        if (!nextDate) continue;

        const diffMs = nextDate.getTime() - today.getTime();
        const daysLeft = Math.round(diffMs / (1000 * 60 * 60 * 24));

        if (daysLeft >= 0 && daysLeft <= 7) {
          upcoming.push({
            ...schedule,
            next_date: formatDate(nextDate),
            days_left: daysLeft
          });
        }
      }

      upcoming.sort((a, b) => a.days_left - b.days_left);
      res.json({ success: true, data: upcoming });
    } catch (error) {
      console.error('다가오는 일정 조회 오류:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /logs - 알림 발송 로그 조회
  router.get('/logs', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const { rows } = await pool.query(
        'SELECT * FROM management_notification_logs ORDER BY sent_at DESC LIMIT $1',
        [limit]
      );
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error('알림 로그 조회 오류:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST / - 일정 추가
  router.post('/', async (req, res) => {
    try {
      const { title, category, repeat_type, month, day, specific_date, description, notify_day_before, notify_on_day, notify_month_before } = req.body;

      // 유효성 검증
      if (!title || !title.trim()) {
        return res.status(400).json({ success: false, error: '제목은 필수입니다' });
      }
      if (repeat_type === 'monthly' && (!day || day < 1 || day > 31)) {
        return res.status(400).json({ success: false, error: '매월 반복 시 날짜(1~31)는 필수입니다' });
      }
      if (repeat_type === 'yearly') {
        if (!month || month < 1 || month > 12 || !day || day < 1 || day > 31) {
          return res.status(400).json({ success: false, error: '매년 반복 시 월(1~12)과 날짜(1~31)는 필수입니다' });
        }
      }
      if (repeat_type === 'once' && !specific_date) {
        return res.status(400).json({ success: false, error: '일회성 일정 시 날짜는 필수입니다' });
      }

      const { rows } = await pool.query(`
        INSERT INTO management_schedules
          (title, category, repeat_type, month, day, specific_date, description, notify_day_before, notify_on_day, notify_month_before)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `, [
        title.trim(),
        category || 'etc',
        repeat_type || 'monthly',
        month || null,
        day || null,
        specific_date || null,
        description || null,
        notify_day_before !== undefined ? notify_day_before : true,
        notify_on_day !== undefined ? notify_on_day : true,
        notify_month_before !== undefined ? notify_month_before : false
      ]);

      console.log(`📅 일정 추가: ${title}`);
      res.json({ success: true, data: rows[0] });
    } catch (error) {
      console.error('일정 추가 오류:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /test-notify - 수동 알림 테스트
  router.post('/test-notify', async (req, res) => {
    try {
      console.log('🧪 [테스트] 알림 테스트 시작');
      const { checkAndNotify } = require('../services/management-scheduler');
      const result = await checkAndNotify(pool, true);
      console.log('🧪 [테스트] 알림 테스트 완료:', JSON.stringify(result));
      res.json({
        success: true,
        message: '테스트 알림 발송 완료',
        monthBefore: result.monthBefore,
        dayBefore: result.dayBefore,
        onDay: result.onDay
      });
    } catch (error) {
      console.error('🧪 [테스트] 알림 테스트 오류:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // PUT /:id - 일정 수정
  router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { title, category, repeat_type, month, day, specific_date, description, notify_day_before, notify_on_day, notify_month_before } = req.body;

      // 유효성 검증
      if (title !== undefined && !title.trim()) {
        return res.status(400).json({ success: false, error: '제목은 필수입니다' });
      }
      if (repeat_type === 'monthly' && (!day || day < 1 || day > 31)) {
        return res.status(400).json({ success: false, error: '매월 반복 시 날짜(1~31)는 필수입니다' });
      }
      if (repeat_type === 'yearly') {
        if (!month || month < 1 || month > 12 || !day || day < 1 || day > 31) {
          return res.status(400).json({ success: false, error: '매년 반복 시 월(1~12)과 날짜(1~31)는 필수입니다' });
        }
      }
      if (repeat_type === 'once' && !specific_date) {
        return res.status(400).json({ success: false, error: '일회성 일정 시 날짜는 필수입니다' });
      }

      const { rows } = await pool.query(`
        UPDATE management_schedules SET
          title = COALESCE($1, title),
          category = COALESCE($2, category),
          repeat_type = COALESCE($3, repeat_type),
          month = $4,
          day = $5,
          specific_date = $6,
          description = $7,
          notify_day_before = COALESCE($8, notify_day_before),
          notify_on_day = COALESCE($9, notify_on_day),
          notify_month_before = COALESCE($10, notify_month_before),
          updated_at = NOW()
        WHERE id = $11
        RETURNING *
      `, [
        title ? title.trim() : null,
        category || null,
        repeat_type || null,
        month || null,
        day || null,
        specific_date || null,
        description !== undefined ? description : null,
        notify_day_before,
        notify_on_day,
        notify_month_before,
        id
      ]);

      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: '일정을 찾을 수 없습니다' });
      }

      console.log(`📅 일정 수정: ${rows[0].title}`);
      res.json({ success: true, data: rows[0] });
    } catch (error) {
      console.error('일정 수정 오류:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // DELETE /:id - 일정 삭제
  router.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { rows } = await pool.query(
        'DELETE FROM management_schedules WHERE id = $1 RETURNING *', [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: '일정을 찾을 수 없습니다' });
      }

      console.log(`🗑️ 일정 삭제: ${rows[0].title}`);
      res.json({ success: true, message: '삭제 완료' });
    } catch (error) {
      console.error('일정 삭제 오류:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // PATCH /:id/toggle - 활성/비활성 토글
  router.patch('/:id/toggle', async (req, res) => {
    try {
      const { id } = req.params;
      const { rows } = await pool.query(`
        UPDATE management_schedules
        SET is_active = NOT is_active, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [id]);

      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: '일정을 찾을 수 없습니다' });
      }

      console.log(`🔄 일정 토글: ${rows[0].title} → ${rows[0].is_active ? '활성' : '비활성'}`);
      res.json({ success: true, data: rows[0] });
    } catch (error) {
      console.error('일정 토글 오류:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
};
