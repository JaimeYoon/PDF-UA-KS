#!/bin/bash
# nas-deploy.sh
# 시놀로지 NAS에 SSH 접속 후 실행하는 배포 스크립트
# 사용법: bash nas-deploy.sh

set -e
NAS_DIR="/volume1/docker/weekly-report"

echo "=== 주간보고 대시보드 NAS 배포 ==="

# 1. 디렉토리 준비
mkdir -p "$NAS_DIR/data"
cd "$NAS_DIR"

# 2. .env 존재 확인
if [ ! -f "$NAS_DIR/.env" ]; then
  echo ""
  echo "❌ .env 파일이 없습니다."
  echo "   아래 명령어로 먼저 .env를 NAS로 복사해주세요 (로컬 Mac 터미널에서):"
  echo ""
  echo "   scp /path/to/weekly-report-local/.env admin@NAS_IP:/volume1/docker/weekly-report/.env"
  echo ""
  exit 1
fi

# 3. 소스 복사 여부 확인 (git clone 방식 지원)
if [ ! -f "$NAS_DIR/docker-compose.yml" ]; then
  echo "❌ docker-compose.yml이 없습니다. 소스를 먼저 복사해주세요."
  echo ""
  echo "   scp -r /path/to/weekly-report-local/ admin@NAS_IP:/volume1/docker/weekly-report/"
  exit 1
fi

# 4. 이미지 빌드 & 컨테이너 시작
echo "🔨 Docker 이미지 빌드 중..."
docker compose build --no-cache

echo "🚀 컨테이너 시작 중..."
docker compose up -d

echo "⏳ 서버 기동 대기 (15초)..."
sleep 15

# 5. 헬스체크
if docker compose ps | grep -q "healthy\|running"; then
  NAS_IP=$(ip route get 1 | awk '{print $7; exit}' 2>/dev/null || hostname -I | awk '{print $1}')
  echo ""
  echo "✅ 배포 완료!"
  echo "   대시보드: http://${NAS_IP}:3000"
  echo ""
  echo "📋 유용한 명령어:"
  echo "   로그 보기:    docker compose logs -f"
  echo "   재시작:       docker compose restart"
  echo "   수동 동기화:  docker compose exec weekly-report node sync.js"
  echo "   중지:         docker compose down"
else
  echo "⚠️  컨테이너 상태를 확인하세요:"
  docker compose ps
  docker compose logs --tail=30
fi
