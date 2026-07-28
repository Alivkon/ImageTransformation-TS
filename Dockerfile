# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy source code
COPY src ./src
COPY frontend ./frontend
COPY static ./static
COPY tsconfig.json ./

# Build
RUN yarn build:all

# В образ идут только .webp — исходные PNG/JPG примеров остаются в репозитории
RUN find frontend-dist/images/examples -type f ! -name '*.webp' -delete

# Runtime stage
FROM node:22-alpine

WORKDIR /app

# Install only production dependencies
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/frontend-dist ./frontend-dist
COPY --from=builder /app/static ./static

RUN mkdir -p /app/uploads

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const port = process.env.WEB_SERVER_PORT || '8080'; require('http').get(`http://localhost:${port}/`, (r) => { if (r.statusCode !== 200) throw new Error(String(r.statusCode)); })"

# Start application
CMD ["node", "dist/index.js"]
