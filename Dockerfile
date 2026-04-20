FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.ts ./
COPY server ./server
COPY src/types ./src/types
COPY tsconfig.json ./

ENV NODE_ENV=production
ENV SERVE_FRONTEND=false
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "run", "start"]
