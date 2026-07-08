FROM node:20

# baileys@6 referencia libsignal-node como URL SSH de GitHub (repo público).
# Redirigir a HTTPS — node:20 ya incluye git, ca-certificates y build tools.
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
