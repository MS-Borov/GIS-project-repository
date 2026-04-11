FROM node:22-alpine

WORKDIR /app

# Оставляем копирование пакетов
COPY package*.json ./
RUN npm install

# Копируем остальной код
COPY . .