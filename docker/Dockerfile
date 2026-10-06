# Production image.
#
# Multi-stage: the builder compiles TypeScript and generates the Prisma Client;
# the final stage only has the result (dist/ + production node_modules), without
# the build toolchain. Both stages use Alpine on purpose: the Prisma binaryTarget
# `linux-musl-openssl-3.0.x` (prisma/schema.prisma) requires it, so the client
# does not have to be regenerated in the final stage.

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
# tsc only compiles .ts: the Eta templates (.eta) and the panel's static CSS are
# not TypeScript, so they are copied separately to the path the compiled code
# expects (dist/web/{views,public}).
COPY --from=builder /app/src/web/views ./dist/web/views
COPY --from=builder /app/src/web/public ./dist/web/public

CMD ["node", "dist/server.js"]
