FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --include=optional

COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["node", "start.js"]
