FROM node:20-alpine

# 타임존 설정
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Seoul /etc/localtime && \
    echo "Asia/Seoul" > /etc/timezone

WORKDIR /app

# 의존성 먼저 복사 (레이어 캐싱)
COPY package.json ./
RUN npm install --omit=dev

# 소스 복사 (data/, .env 제외 — .dockerignore로 처리)
COPY . .

# data 디렉토리는 볼륨으로 마운트됨
RUN mkdir -p /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s \
  CMD wget -qO- http://localhost:3000/api/dashboard || exit 1

CMD ["node", "server.js"]
