FROM node:20-bookworm-slim

# Instalar Chromium e dependências necessárias do sistema para o Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Configurar variáveis de ambiente do Puppeteer para usar o Chromium do sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Definir diretório de trabalho
WORKDIR /app

# Copiar arquivos de mídia e dados localizados na raiz do projeto
COPY ["Logo Audaz Fundo Transparente.png", "/app/"]
COPY ["Taxas locais Armadores 2026.xlsx", "/app/"]

# Copiar os arquivos do backend
COPY backend/ /app/backend/

# Ajustar diretório de trabalho para o backend
WORKDIR /app/backend

# Remover qualquer resquício de node_modules local antes de instalar
RUN rm -rf node_modules

# Instalar as dependências do projeto limpas
RUN npm ci

# Gerar o cliente do Prisma com base no schema
RUN npx prisma generate

# Compilar o código TypeScript para JavaScript (dist/)
RUN npm run build

# Definir porta de escuta
ENV PORT=3001
EXPOSE 3001

# Executa push no banco SQLite local (garante criação do arquivo e das tabelas) e inicia o servidor
CMD npx prisma db push && npm start
