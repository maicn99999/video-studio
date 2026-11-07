FROM node:22-alpine
# WITH_PDF=true: cài Chromium + font Noto/DejaVu (đủ dấu tiếng Việt) để xuất PDF phía máy chủ.
# Đặt WITH_PDF=false chỉ khi môi trường build không truy cập được kho gói Alpine (vd: CI kín).
ARG WITH_PDF=true
RUN if [ "$WITH_PDF" = "true" ]; then \
      apk add --no-cache chromium font-noto font-dejavu \
      && (test -x /usr/bin/chromium-browser || ln -s /usr/bin/chromium /usr/bin/chromium-browser); \
    fi
ENV NODE_ENV=production \
    CHROMIUM_PATH=/usr/bin/chromium-browser \
    PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY public ./public
COPY mock ./mock
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
CMD ["node", "src/server.js"]
