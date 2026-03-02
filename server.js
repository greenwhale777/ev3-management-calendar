/**
 * EV3 관리 일정 알림봇 서버
 *
 * 기능:
 * - 관리 일정 CRUD API
 * - 매일 09:00 KST 텔레그램 알림 (D-1, 당일)
 * - 알림 발송 로그
 */

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3002;

// ============ DB 연결 ============
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ============ 미들웨어 ============
app.use(cors());
app.use(express.json());

// ============ DB 초기화 ============
async function initDB() {
  const client = await pool.connect();
  try {
    // 관리 일정 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS management_schedules (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        category VARCHAR(50) NOT NULL DEFAULT 'etc',
        repeat_type VARCHAR(20) NOT NULL DEFAULT 'monthly',
        month INTEGER,
        day INTEGER,
        specific_date DATE,
        description TEXT,
        notify_day_before BOOLEAN DEFAULT true,
        notify_on_day BOOLEAN DEFAULT true,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 알림 발송 로그 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS management_notification_logs (
        id SERIAL PRIMARY KEY,
        schedule_id INTEGER REFERENCES management_schedules(id) ON DELETE SET NULL,
        notification_type VARCHAR(20) NOT NULL,
        title VARCHAR(200) NOT NULL,
        category VARCHAR(50),
        sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        status VARCHAR(20) DEFAULT 'SUCCESS',
        message TEXT,
        error_message TEXT
      );
    `);

    // notify_month_before 컬럼 추가 (D-30 알림)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'management_schedules' AND column_name = 'notify_month_before'
        ) THEN
          ALTER TABLE management_schedules ADD COLUMN notify_month_before BOOLEAN DEFAULT false;
        END IF;
      END $$;
    `);

    // 인덱스 생성
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_schedules_active ON management_schedules(is_active);
      CREATE INDEX IF NOT EXISTS idx_schedules_category ON management_schedules(category);
      CREATE INDEX IF NOT EXISTS idx_notification_logs_sent ON management_notification_logs(sent_at DESC);
    `);

    console.log('✅ DB 테이블 초기화 완료');
  } finally {
    client.release();
  }
}

// ============ 라우트 등록 ============
const calendarRoutes = require('./routes/management-calendar');
app.use('/api/management-calendar', calendarRoutes(pool));

// ============ 헬스 체크 ============
app.get('/', (req, res) => {
  res.json({ service: 'ev3-management-calendar', status: 'running', version: '1.0.0' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ 서버 시작 ============
async function start() {
  try {
    await initDB();

    // 스케줄러 시작
    const { startScheduler } = require('./services/management-scheduler');
    startScheduler(pool);

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 EV3 관리 일정 알림봇 서버 포트 ${PORT}에서 실행 중`);
    });
  } catch (error) {
    console.error('서버 시작 실패:', error);
    process.exit(1);
  }
}

start();
