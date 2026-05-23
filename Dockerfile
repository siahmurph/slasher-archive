FROM node:18-alpine

WORKDIR /app

# Copy dependency manifests
COPY package.json ./

# Install production dependencies
RUN npm install --only=production

# Copy application files
COPY server.js index.html styles.css app.js ./

EXPOSE 80

ENV PORT=80

CMD ["node", "server.js"]
