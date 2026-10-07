FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production --no-audit --no-fund && node -e "require('express')"
COPY . .
ENV NODE_ENV=production
# SERVICE selects the app: customer-service | business-insights | industry-apis
CMD ["sh", "-c", "node ${SERVICE:-customer-service}.js"]
