# Imagem de produção.
#
# Multi-stage: o builder compila o TypeScript e gera o Prisma Client;
# o estágio final só tem o resultado (dist/ + node_modules de produção), sem
# as ferramentas de build. Os dois estágios usam Alpine de propósito: o binaryTarget
# `linux-musl-openssl-3.0.x` do Prisma (prisma/schema.prisma) exige isso, então o
# client não precisa ser gerado de novo no estágio final.

FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ openssl
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
# O tsc só compila .ts: os templates Eta (.eta) e o CSS estático do painel não são
# TypeScript, então são copiados separadamente para o caminho que o código compilado
# espera (dist/web/{views,public}).
COPY --from=builder /app/src/web/views ./dist/web/views
COPY --from=builder /app/src/web/public ./dist/web/public

CMD ["node", "dist/server.js"]
