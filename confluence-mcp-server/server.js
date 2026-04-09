/**
 * Confluence Weekly Report MCP Server
 *
 * 두 가지 모드로 실행:
 * 1. MCP 모드 (stdio): Claude Desktop, Claude Code와 직접 통신
 * 2. HTTP 모드: WordPress 플러그인에서 REST API로 호출
 *
 * 실행: node server.js [--http]
 */

import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import express from 'express';
import cron from 'node-cron';
import { ConfluenceClient } from './confluence-client.js';
import { ReportAnalyzer } from './report-analyzer.js';
import { WordPressSync } from './wordpress-sync.js';

// ── 클라이언트 초기화 ──────────────────────────────────────────────────────
const confluence = new ConfluenceClient({
  baseUrl: process.env.CONFLUENCE_BASE_URL,
  type: process.env.CONFLUENCE_TYPE || 'cloud',
  email: process.env.CONFLUENCE_EMAIL,
  apiToken: process.env.CONFLUENCE_API_TOKEN,
  username: process.env.CONFLUENCE_USERNAME,
  password: process.env.CONFLUENCE_PASSWORD,
});

const analyzer = new ReportAnalyzer();

const wpSync = process.env.WORDPRESS_URL ? new WordPressSync({
  url: process.env.WORDPRESS_URL,
  user: process.env.WORDPRESS_API_USER,
  password: process.env.WORDPRESS_API_PASSWORD,
}) : null;

// ── 핵심 동기화 함수 ──────────────────────────────────────────────────────
async function runFullSync() {
  console.log(`[${new Date().toISOString()}] 주간보고 동기화 시작...`);

  const spaceKey = process.env.CONFLUENCE_SPACE_KEY;
  const titlePattern = process.env.REPORT_TITLE_PATTERN || '주간보고';

  // 최근 보고 2주치 가져오기
  const reports = await confluence.getWeeklyReports({
    spaceKey,
    titlePattern,
    limit: 30,
  });

  if (reports.length === 0) {
    console.log('보고서를 찾을 수 없습니다.');
    return { synced: 0 };
  }

  // 이번주 / 지난주 구분 (최신 보고 vs 이전 보고)
  const thisWeekReports = reports.slice(0, Math.ceil(reports.length / 2));
  const lastWeekReports = reports.slice(Math.ceil(reports.length / 2));

  const currentParsed = [];
  const previousParsed = [];

  // 이번주 보고 분석
  for (const report of thisWeekReports) {
    const parsed = await analyzer.parseReport(report.plainText, report.author);
    currentParsed.push({ ...report, parsed });
    if (wpSync) await wpSync.saveMemberReport({ ...report, parsed });
  }

  // 지난주 보고 분석
  for (const report of lastWeekReports) {
    const parsed = await analyzer.parseReport(report.plainText, report.author);
    previousParsed.push({ ...report, parsed });
  }

  // 팀 전체 요약 분석
  const teamSummary = await analyzer.analyzeTeamSummary(currentParsed, previousParsed);
  if (wpSync) await wpSync.saveSummary(teamSummary);
  if (wpSync) await wpSync.updateSyncTime();

  console.log(`[${new Date().toISOString()}] 동기화 완료: ${currentParsed.length}건`);
  return { synced: currentParsed.length, teamSummary };
}

// ── MCP 서버 정의 ─────────────────────────────────────────────────────────
const mcp = new McpServer({
  name: 'confluence-weekly-report',
  version: '1.0.0',
});

// Tool: 스페이스 목록 조회
mcp.tool(
  'list_spaces',
  '사용 가능한 Confluence 스페이스 목록을 조회합니다',
  {},
  async () => {
    const spaces = await confluence.listSpaces();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(spaces.map(s => ({
          key: s.key,
          name: s.name,
          type: s.type,
        })), null, 2),
      }],
    };
  }
);

// Tool: 주간보고 페이지 검색
mcp.tool(
  'search_weekly_reports',
  'Confluence에서 주간보고 페이지를 검색합니다',
  {
    spaceKey: z.string().describe('Confluence 스페이스 키 (예: WEEKLY)'),
    titlePattern: z.string().default('주간보고').describe('제목 검색 패턴'),
    limit: z.number().default(10).describe('최대 결과 수'),
  },
  async ({ spaceKey, titlePattern, limit }) => {
    const pages = await confluence.searchPages({ spaceKey, titlePattern, limit });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(pages.map(p => ({
          id: p.id,
          title: p.title,
          lastModified: p.version?.when,
          author: p.version?.by?.displayName,
        })), null, 2),
      }],
    };
  }
);

// Tool: 특정 페이지 내용 가져오기
mcp.tool(
  'get_report_content',
  'Confluence 페이지의 내용을 가져옵니다',
  {
    pageId: z.string().describe('Confluence 페이지 ID'),
  },
  async ({ pageId }) => {
    const content = await confluence.getPageContent(pageId);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(content, null, 2),
      }],
    };
  }
);

// Tool: 주간보고 분석 (현재 주)
mcp.tool(
  'analyze_report',
  '주간보고 텍스트를 AI로 분석하여 진척도와 이슈를 구조화합니다',
  {
    pageId: z.string().describe('분석할 Confluence 페이지 ID'),
  },
  async ({ pageId }) => {
    const content = await confluence.getPageContent(pageId);
    const parsed = await analyzer.parseReport(content.plainText, content.author);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ page: content, analysis: parsed }, null, 2),
      }],
    };
  }
);

// Tool: 지난주 대비 변화 분석
mcp.tool(
  'compare_with_previous_week',
  '이번주 보고와 지난주 보고를 비교하여 변화를 분석합니다',
  {
    currentPageId: z.string().describe('이번주 페이지 ID'),
    previousPageId: z.string().describe('지난주 페이지 ID'),
  },
  async ({ currentPageId, previousPageId }) => {
    const [current, previous] = await Promise.all([
      confluence.getPageContent(currentPageId),
      confluence.getPageContent(previousPageId),
    ]);
    const [currentParsed, previousParsed] = await Promise.all([
      analyzer.parseReport(current.plainText, current.author),
      analyzer.parseReport(previous.plainText, previous.author),
    ]);
    const diff = await analyzer.analyzeDiff(currentParsed, previousParsed);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          current: { page: current, analysis: currentParsed },
          previous: { page: previous, analysis: previousParsed },
          diff,
        }, null, 2),
      }],
    };
  }
);

// Tool: 팀 전체 주간보고 일괄 분석
mcp.tool(
  'analyze_team_reports',
  '팀 전체 주간보고를 한번에 분석하여 WordPress 대시보드로 동기화합니다',
  {
    spaceKey: z.string().describe('Confluence 스페이스 키'),
    titlePattern: z.string().default('주간보고').describe('제목 패턴'),
  },
  async ({ spaceKey, titlePattern }) => {
    // 환경변수 임시 오버라이드
    process.env.CONFLUENCE_SPACE_KEY = spaceKey;
    process.env.REPORT_TITLE_PATTERN = titlePattern;
    const result = await runFullSync();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// ── HTTP 서버 (WordPress 플러그인 → MCP 브릿지) ───────────────────────────
function startHttpServer() {
  const app = express();
  app.use(express.json());

  // 보안: API 키 검증 미들웨어
  app.use((req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (process.env.MCP_API_KEY && apiKey !== process.env.MCP_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });

  // 헬스 체크
  app.get('/health', (_, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // 주간보고 전체 동기화 트리거
  app.post('/sync', async (req, res) => {
    try {
      const result = await runFullSync();
      res.json({ success: true, ...result });
    } catch (err) {
      console.error('동기화 오류:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 특정 페이지 분석
  app.post('/analyze', async (req, res) => {
    const { pageId, authorName } = req.body;
    if (!pageId) return res.status(400).json({ error: 'pageId 필요' });
    try {
      const content = await confluence.getPageContent(pageId);
      const parsed = await analyzer.parseReport(content.plainText, authorName || content.author);
      res.json({ success: true, content, parsed });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 두 페이지 비교
  app.post('/compare', async (req, res) => {
    const { currentPageId, previousPageId } = req.body;
    if (!currentPageId || !previousPageId) {
      return res.status(400).json({ error: 'currentPageId, previousPageId 필요' });
    }
    try {
      const [current, previous] = await Promise.all([
        confluence.getPageContent(currentPageId),
        confluence.getPageContent(previousPageId),
      ]);
      const [cp, pp] = await Promise.all([
        analyzer.parseReport(current.plainText, current.author),
        analyzer.parseReport(previous.plainText, previous.author),
      ]);
      const diff = await analyzer.analyzeDiff(cp, pp);
      res.json({ success: true, current: { ...current, parsed: cp }, previous: { ...previous, parsed: pp }, diff });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 팀 보고 목록 조회
  app.get('/reports', async (req, res) => {
    const { spaceKey, titlePattern, limit } = req.query;
    try {
      const pages = await confluence.searchPages({
        spaceKey: spaceKey || process.env.CONFLUENCE_SPACE_KEY,
        titlePattern: titlePattern || process.env.REPORT_TITLE_PATTERN || '주간보고',
        limit: parseInt(limit) || 20,
      });
      res.json({ success: true, pages });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  const port = process.env.MCP_HTTP_PORT || 3456;
  app.listen(port, () => {
    console.log(`MCP HTTP 서버 실행 중: http://localhost:${port}`);
  });

  // 자동 동기화 스케줄 (cron)
  const cronExpr = process.env.SYNC_CRON || '0 9,18 * * 1-5';
  cron.schedule(cronExpr, async () => {
    console.log(`[cron] 자동 동기화 실행: ${new Date().toISOString()}`);
    await runFullSync().catch(err => console.error('[cron] 오류:', err));
  }, { timezone: 'Asia/Seoul' });

  console.log(`자동 동기화 스케줄: ${cronExpr} (Asia/Seoul)`);
}

// ── 진입점 ────────────────────────────────────────────────────────────────
const isHttpMode = process.argv.includes('--http');

if (isHttpMode) {
  // WordPress 플러그인과 통신하는 HTTP 서버 모드
  startHttpServer();
} else {
  // Claude Desktop / Claude Code와 stdio로 통신하는 MCP 모드
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  console.error('Confluence MCP 서버 실행 중 (stdio 모드)');
}
