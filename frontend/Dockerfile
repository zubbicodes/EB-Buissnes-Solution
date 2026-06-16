FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm cache clean --force && npm install --legacy-peer-deps --force

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
