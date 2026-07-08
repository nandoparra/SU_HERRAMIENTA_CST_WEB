FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# baileys@6 tiene libsignal-node como URL SSH de GitHub (repo público).
# El contenedor no tiene claves SSH — redirigir a HTTPS para el clone.
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
