# 주간보고 대시보드 (Confluence → Synology NAS WordPress)

Confluence에 작성된 팀 주간보고를 자동으로 분석하여 WordPress 대시보드에서 진척도를 시각적으로 보여주는 시스템입니다.

---

## 아키텍처

```
[Confluence] ──REST API──▶ [MCP HTTP 서버 (Node.js)]
                                     │ HTTP (REST)
                                     ▼
                          [WordPress 플러그인]
                                     │
                                     ▼
                          [대시보드 페이지 (Chart.js)]
```

- **MCP 서버** (Node.js) — Confluence API 통신, Claude로 보고 텍스트 파싱·분석
- **WordPress 플러그인** — DB 저장, REST API, 대시보드 UI
- **자동 동기화** — Node.js cron + WordPress WP-Cron으로 이중 스케줄

---

## 디렉토리 구조

```
├── confluence-mcp-server/       # Node.js MCP + HTTP 서버
│   ├── server.js                # 메인 진입점 (MCP 모드 / HTTP 모드)
│   ├── confluence-client.js     # Confluence REST API 클라이언트
│   ├── report-analyzer.js       # Claude API 보고서 분석
│   ├── wordpress-sync.js        # WordPress REST API 업로드
│   ├── package.json
│   └── .env.example             # 환경변수 템플릿
│
└── wordpress-plugin/
    └── weekly-report-dashboard/
        ├── weekly-report-dashboard.php   # 플러그인 메인
        ├── includes/
        │   ├── class-db.php              # DB 테이블 & 쿼리
        │   ├── class-confluence-sync.php # MCP 서버 호출 & 동기화
        │   ├── class-api.php             # WordPress REST API 엔드포인트
        │   ├── class-admin.php           # 관리자 페이지
        │   └── class-shortcode.php       # [weekly_report_dashboard] 쇼트코드
        ├── templates/
        │   └── dashboard.php             # 대시보드 HTML 템플릿
        └── assets/
            ├── dashboard.js              # 대시보드 JavaScript (Chart.js)
            └── dashboard.css             # 스타일시트
```

---

## 설치 및 설정

### 1. MCP 서버 설치 (Synology NAS)

Synology NAS에서 Node.js 패키지를 활성화하거나 Docker로 실행합니다.

```bash
cd confluence-mcp-server
cp .env.example .env
nano .env          # 아래 환경변수 채우기
npm install
```

**.env 설정 항목:**

| 변수 | 설명 |
|------|------|
| `CONFLUENCE_BASE_URL` | Confluence 주소 (예: `https://yourco.atlassian.net/wiki`) |
| `CONFLUENCE_EMAIL` | Confluence Cloud 이메일 |
| `CONFLUENCE_API_TOKEN` | Confluence API 토큰 ([발급: id.atlassian.com → Security → API tokens]) |
| `CONFLUENCE_SPACE_KEY` | 주간보고가 있는 스페이스 키 (예: `WEEKLY`) |
| `REPORT_TITLE_PATTERN` | 페이지 제목 검색 키워드 (기본: `주간보고`) |
| `ANTHROPIC_API_KEY` | Claude API 키 |
| `WORDPRESS_URL` | WordPress 주소 (예: `http://192.168.1.100/wordpress`) |
| `WORDPRESS_API_USER` | WordPress 사용자명 |
| `WORDPRESS_API_PASSWORD` | WordPress Application Password |
| `MCP_HTTP_PORT` | HTTP 서버 포트 (기본: `3456`) |
| `MCP_API_KEY` | WordPress ↔ MCP 통신 시 API 키 (임의 문자열 설정) |

```bash
# HTTP 서버 모드로 실행 (WordPress와 통신)
node server.js --http

# 또는 MCP 모드 (Claude Desktop/Code와 직접 통신)
node server.js
```

#### PM2로 백그라운드 실행 (권장)

```bash
npm install -g pm2
pm2 start server.js --name wrd-mcp -- --http
pm2 save
pm2 startup    # 시스템 시작 시 자동 실행 설정
```

### 2. WordPress 플러그인 설치

`wordpress-plugin/weekly-report-dashboard/` 폴더를 WordPress의 `wp-content/plugins/`에 복사:

Synology NAS 경로 예시:
```
/volume1/web/wordpress/wp-content/plugins/weekly-report-dashboard/
```

WordPress 관리자 → **플러그인** → **Weekly Report Dashboard** 활성화

### 3. 플러그인 설정

WordPress 관리자 → **주간보고** → **설정**

| 설정 | 값 |
|------|----|
| MCP 서버 URL | `http://localhost:3456` (같은 NAS면 localhost) |
| MCP API Key | `.env`의 `MCP_API_KEY`와 동일 |
| Confluence Space Key | 보고서가 있는 스페이스 키 |
| 보고 제목 패턴 | `주간보고` |

### 4. 대시보드 페이지 생성

WordPress 관리자 → **페이지** → **새로 추가**

페이지 내용에 다음 쇼트코드 입력:
```
[weekly_report_dashboard]
```

페이지 제목을 "주간보고 대시보드"로 저장 후 공개.

---

## Confluence 주간보고 형식

자유 텍스트 형식이면 됩니다. Claude가 자동으로 아래 내용을 추출합니다:
- 작업명과 진척도 %
- 완료 / 진행중 / 블로킹 여부
- 주요 성과와 이슈
- 다음주 계획

**예시 페이지 제목:** `주간보고 2025-01-06` 또는 `주간보고 2025년 2주차`

---

## Claude Desktop에서 MCP 사용

`~/.claude/claude_desktop_config.json`에 추가:

```json
{
  "mcpServers": {
    "confluence-weekly-report": {
      "command": "node",
      "args": ["/path/to/confluence-mcp-server/server.js"],
      "env": {
        "CONFLUENCE_BASE_URL": "https://yourco.atlassian.net/wiki",
        "CONFLUENCE_EMAIL": "your@email.com",
        "CONFLUENCE_API_TOKEN": "your_token",
        "CONFLUENCE_SPACE_KEY": "WEEKLY",
        "ANTHROPIC_API_KEY": "your_key"
      }
    }
  }
}
```

이후 Claude에서 직접 질의 가능:
- "이번주 팀 주간보고 분석해줘"
- "홍길동의 지난주 대비 변화를 알려줘"
- "팀 전체 진척도 동기화해줘"

---

## 동기화 흐름

```
1. [자동/수동] 동기화 트리거
2. MCP 서버 → Confluence REST API: 주간보고 페이지 목록 조회
3. 각 페이지 본문 가져오기 (Storage Format HTML → 텍스트 변환)
4. Claude API: 텍스트 → 구조화 데이터 (진척도, 이슈, 성과 등)
5. 이번주 vs 지난주 페이지 비교 → 변화 분석
6. Claude API: 팀 전체 종합 분석
7. WordPress REST API: DB 저장
8. 대시보드 JS: WordPress REST API에서 실시간 조회 및 Chart.js 시각화
```

---

## 보안 고려사항

- MCP API Key를 반드시 설정하세요 (외부에서 동기화 트리거 방지)
- WordPress Application Password는 해당 사용자 전용으로 생성하세요
- Synology NAS 방화벽에서 포트 3456은 내부 IP만 허용 권장
- HTTPS 사용 시 `CONFLUENCE_BASE_URL`에 https 사용
