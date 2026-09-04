FROM node:22-alpine

WORKDIR /app

# Manifests first so dependency installs stay cached across source edits.
COPY package.json package-lock.json ./

# npm ci installs exactly what the lockfile pins — reproducible across rebuilds.
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY public ./public

# Config lives outside the static root so it can never be served as an asset.
ENV CONFIG_DIR=/config
# Port 8080, not 80: the container runs as a non-root user, and binding a
# privileged port then depends on runtime capability/sysctl defaults.
ENV PORT=8080
ENV NODE_ENV=production

RUN mkdir -p /config && chown -R node:node /config /app

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||8080,path:'/healthz'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
