/**
 * sync.js — Confluence에서 최신 주간보고를 가져와 로컬 JSON으로 저장
 * 실행: node sync.js
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ConfluenceClient } from './confluence.js';
import { parseReport, analyzeDiff } from './analyzer.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dir, 'data');
const INDEX_FILE = join(DATA_DIR, 'index.json');
const LOG_FILE = join(DATA_DIR, 'sync.log');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  const prev = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8') : '';
  // 최근 200줄만 유지
  const lines = (prev + '\n' + line).split('\n').filter(Boolean);
  writeFileSync(LOG_FILE, lines.slice(-200).join('\n') + '\n');
}

function loadIndex() {
  if (!existsSync(INDEX_FILE)) return { reports: [], lastSync: null };
  return JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
}

function saveIndex(data) {
  writeFileSync(INDEX_FILE, JSON.stringify(data, null, 2));
}

export async function runSync() {
  log('동기화 시작...');
  const client = new ConfluenceClient();
  const index = loadIndex();

  // 1. 최신 2개 페이지 가져오기
  const { current, previous, allPages } = await client.getLatestTwo();
  log(`최신 페이지: "${current.title}" / 이전: "${previous?.title || '없음'}"`);

  // 2. 이미 분석된 데이터인지 확인
  const alreadySynced = index.reports.find(r => r.id === current.id);
  if (alreadySynced && !process.argv.includes('--force')) {
    log(`"${current.title}"은 이미 분석되어 있습니다. 강제 재실행: --force`);
    return { skipped: true, title: current.title };
  }

  // 3. 현재 보고 파싱
  log('Claude로 현재 보고 분석 중...');
  const currentParsed = await parseReport(current.plainText, current.title);

  // 4. 이전 보고 파싱 (캐시 우선)
  let previousParsed = null;
  if (previous) {
    const cachedPrev = index.reports.find(r => r.id === previous.id);
    if (cachedPrev?.parsed) {
      previousParsed = cachedPrev.parsed;
      log(`이전 보고 캐시 사용: "${previous.title}"`);
    } else {
      log('Claude로 이전 보고 분석 중...');
      previousParsed = await parseReport(previous.plainText, previous.title);
      // 캐시에 저장
      const prevIdx = index.reports.findIndex(r => r.id === previous.id);
      const prevEntry = { id: previous.id, title: previous.title, lastModified: previous.lastModified, url: previous.url, parsed: previousParsed };
      if (prevIdx >= 0) index.reports[prevIdx] = prevEntry;
      else index.reports.unshift(prevEntry);
    }
  }

  // 5. 이번주 vs 지난주 비교
  log('지난주 대비 변화 분석 중...');
  const diff = await analyzeDiff(currentParsed, previousParsed);

  // 6. 저장
  const entry = {
    id: current.id,
    title: current.title,
    lastModified: current.lastModified,
    url: current.url,
    parsed: currentParsed,
    diff,
    syncedAt: new Date().toISOString(),
  };

  const existingIdx = index.reports.findIndex(r => r.id === current.id);
  if (existingIdx >= 0) index.reports[existingIdx] = entry;
  else index.reports.unshift(entry);

  // 전체 페이지 목록도 업데이트
  index.allPages = allPages;
  index.lastSync = new Date().toISOString();
  index.currentId = current.id;

  saveIndex(index);
  log(`저장 완료: data/index.json (총 ${index.reports.length}개)`);
  return { success: true, title: current.title, progress: currentParsed.overall_progress };
}

// 직접 실행 시
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSync()
    .then(r => { console.log('결과:', r); process.exit(0); })
    .catch(e => { console.error('오류:', e.message); process.exit(1); });
}
