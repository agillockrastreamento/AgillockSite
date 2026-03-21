#!/bin/sh
set -e

echo "==> Instalando dependências..."
npm install --silent

echo "==> Gerando Prisma Client..."
npx prisma generate

echo "==> Rodando migrations..."
npx prisma migrate deploy

echo "==> Rodando seed..."
npx tsx scripts/seed-admin.ts

echo "==> Iniciando servidor (hot reload ativado)..."
exec npx nodemon --legacy-watch --watch src --ext ts --exec "npx tsx src/server.ts"
