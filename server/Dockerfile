# API do Arka (Express + Prisma/SQLite).
FROM node:20-slim

# openssl -> exigido pelo engine do Prisma.
# sqlite3 -> usado pelo backup quente do banco (deploy/backup.sh).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates sqlite3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# As devDependencies ficam na imagem de proposito: o Prisma CLI e quem aplica o
# schema no banco (`prisma db push`) toda vez que o container sobe.
COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
COPY docker-entrypoint.sh ./
# O projeto e editado no Windows; se o arquivo chegar com CRLF o shell reclama
# de "bad interpreter". Normaliza antes de tornar executavel.
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh

# O banco NAO fica na imagem: vive em /data, que o compose monta como volume.
RUN mkdir -p /data && chown -R node:node /data
USER node

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
