FROM node:20-alpine

WORKDIR /app
ENV PORT=8080

# package.json is copied for its `"type": "module"` only -- the server has no
# runtime dependencies, so there is no install step. Without it the image would
# rely on Node's ESM syntax auto-detection to run server.js.
COPY package.json ./
COPY dist ./dist
COPY server.js ./
# server/ holds the admin-agent modules and guardrailCatalog.json, which is read
# from disk at runtime. Omitting it makes the container exit on import.
COPY server ./server

EXPOSE 8080

CMD ["node", "server.js"]
