FROM node:20-bookworm

# Instalar dependências de sistema necessárias para o Chrome/Chromium
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Desabilitar D-Bus completamente com formato de endereço válido
# O formato unix:path=... é o formato correto que o D-Bus entende
ENV DBUS_SESSION_BUS_ADDRESS=unix:path=/dev/null
ENV DBUS_SYSTEM_BUS_ADDRESS=unix:path=/dev/null

# NÃO pular o download do Chromium do Puppeteer - ele vai baixar a versão exata que funciona
# ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
# O cache do Puppeteer fica em ~/.cache/puppeteer
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

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

# Instalar as dependências do projeto - o Puppeteer vai baixar o Chrome aqui
RUN npm ci

# Gerar o cliente do Prisma com base no schema
RUN npx prisma generate

# Compilar o código TypeScript para JavaScript (dist/)
RUN npm run build

# Definir porta de escuta
ENV PORT=3001
EXPOSE 3001

# Executa push no banco SQLite local e inicia o servidor
CMD npx prisma db push && npm start
