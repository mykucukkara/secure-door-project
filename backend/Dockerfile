FROM node:22

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm cache clean --force && npm install --no-audit --no-fund

ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/dummy_db?schema=public"
RUN npx prisma generate

COPY . .
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
