FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && apk add --no-cache wget

COPY . .

ENV NODE_ENV=production

USER node

EXPOSE 3000

CMD ["sh", "-c", "npm run migrate && npm run seed && npm start"]
