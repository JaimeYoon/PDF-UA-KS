/**
 * server.js — 로컬 대시보드 웹 서버 + 자동 스케줄링
 * 실행: node server.js
 */
import 'dotenv/config';
import express from 'express';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import open from 'open';
import { runSync } from './sync.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dir, 'data');
const INDEX_FILE = join(DATA_DIR, 'index.json');
const PORT = parseInt(process.env.PORT || '3000');

const app = express();
app.use(express.static(join(__dir, 'public')));

// ── API: 대시보드 데이터 ────────────────────────────────────────
app.get('/api/dashboard', (req, res) => {
  if (!existsSync(INDEX_FILE)) {
    return res.json({ empty: true, message: '아직 동기화된 데이터가 없습니다. node sync.js를 먼저 실행하세요.' });
  }
  const index = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
  const current = index.reports.find(r => r.id === index.currentId) || index.reports[0];
  const previous = index.reports.find(r => r.id !== (current?.id) && index.reports.indexOf(r) === 1)
    || index.reports[1];

  res.json({
    lastSync: index.lastSync,
    currentReport: current || null,
    previousReport: previous || null,
    allPages: index.allPages || [],
    reportCount: index.reports.length,
  });
});

// ── API: 특정 보고 조회 ────────────────────────────────────────
app.get('/api/report/:id', (req, res) => {
  if (!existsSync(INDEX_FILE)) return res.status(404).json({ error: '데이터 없음' });
  const index = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
  const report = index.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: '해당 보고를 찾을 수 없습니다.' });
  res.json(report);
});

// ── API: 모든 보고 목록 ────────────────────────────────────────
app.get('/api/reports', (req, res) => {
  if (!existsSync(INDEX_FILE)) return res.json([]);
  const index = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
  res.json(index.reports.map(r => ({
    id: r.id, title: r.title, lastModified: r.lastModified,
    url: r.url, progress: r.parsed?.overall_progress ?? null,
    syncedAt: r.syncedAt,
  })));
});

// ── API: 수동 동기화 트리거 ────────────────────────────────────
app.post('/api/sync', async (req, res) => {
  try {
    const result = await runSync();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 자동 스케줄: 매주 월요일 오전 9시 ───────────────────────────
// 변경하려면: https://crontab.guru 참고
const SCHEDULE = '0 9 * * 1'; // 월요일 09:00
cron.schedule(SCHEDULE, async () => {
  console.log(`[cron] ${new Date().toLocaleString('ko-KR')} 자동 동기화 실행`);
  await runSync().catch(e => console.error('[cron] 오류:', e.message));
}, { timezone: 'Asia/Seoul' });

// ── 서버 시작 ─────────────────────────────────────────────────
app.listen(PORT, async () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n✅ 주간보고 대시보드 실행 중: ${url}`);
  console.log(`📅 자동 동기화: 매주 월요일 오전 9시 (Asia/Seoul)`);
  console.log(`🔄 수동 동기화: node sync.js\n`);
  // 처음 실행 시 브라우저 자동 오픈
  await open(url).catch(() => {});
});
