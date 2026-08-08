#!/bin/bash
# setup.sh — 로컬 환경 초기 설정 스크립트
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="com.weekly-report.dashboard"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

echo "=== 주간보고 대시보드 설치 ==="
echo ""

# 1. 의존성 설치
echo "📦 패키지 설치 중..."
cd "$DIR"
npm install
echo "✅ 완료"
echo ""

# 2. .env 설정
if [ ! -f "$DIR/.env" ]; then
  cp "$DIR/.env.example" "$DIR/.env"
  echo "⚠️  .env 파일을 생성했습니다. 아래 항목을 채워주세요:"
  echo "    $DIR/.env"
  echo ""
  echo "  필수 항목:"
  echo "    CONFLUENCE_EMAIL=your-email@hancom.com"
  echo "    CONFLUENCE_API_TOKEN=<Atlassian API 토큰>"
  echo "    ANTHROPIC_API_KEY=sk-ant-..."
  echo ""
  echo "  Atlassian API 토큰 발급:"
  echo "  https://id.atlassian.com/manage-profile/security/api-tokens"
  echo ""
  read -p "  .env 설정 후 Enter를 눌러 계속하세요..."
fi

# 3. macOS LaunchAgent 등록 (서버 자동 시작)
echo "🕒 macOS LaunchAgent 등록 중..."
mkdir -p "$HOME/Library/LaunchAgents"

NODE_BIN="$(which node)"

cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_BIN}</string>
        <string>${DIR}/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${DIR}/data/server.log</string>
    <key>StandardErrorPath</key>
    <string>${DIR}/data/server.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:$(dirname $NODE_BIN)</string>
    </dict>
</dict>
</plist>
PLIST

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"
echo "✅ LaunchAgent 등록 완료 (Mac 재시작 후에도 자동 실행됩니다)"
echo ""

# 4. 첫 동기화
echo "🔄 첫 번째 동기화 실행 중..."
echo "   (Confluence에서 데이터를 가져와 Claude로 분석합니다. 1-2분 소요)"
echo ""
node "$DIR/sync.js"

echo ""
echo "==================================="
echo "✅ 설치 완료!"
echo ""
echo "  대시보드: http://localhost:3000"
echo ""
echo "  주요 명령어:"
echo "  - 브라우저 열기: open http://localhost:3000"
echo "  - 수동 동기화:   node sync.js"
echo "  - 서버 중지:     launchctl unload ~/Library/LaunchAgents/$PLIST_NAME.plist"
echo "  - 서버 재시작:   launchctl kickstart -k gui/\$(id -u)/$PLIST_NAME"
echo "==================================="
echo ""
open "http://localhost:3000"
