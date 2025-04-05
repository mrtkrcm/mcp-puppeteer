# Stage 1: Build the application
ARG NODE_VERSION=20
FROM --platform=$BUILDPLATFORM node:$NODE_VERSION AS builder

WORKDIR /app

# Copy necessary files for build
COPY package*.json ./
COPY tsconfig.json ./
COPY index.ts ./
COPY src/ ./src/

# Install all dependencies (including devDependencies needed for build)
RUN npm ci

# Build the application
RUN npm run build

# Stage 2: Create the final production image
FROM --platform=$BUILDPLATFORM node:$NODE_VERSION AS final

LABEL org.opencontainers.image.source=https://github.com/mrtkrcm/mcp-puppeteer
LABEL org.opencontainers.image.description="MCP Puppeteer - Remote Browser Automation Server"
LABEL org.opencontainers.image.licenses=MIT

WORKDIR /app

# Copy package files needed for production dependencies
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Skip Chrome download as remote server could be preferred
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV DEBUG=mcp-puppeteer:*

# Install libnss3 package
RUN apt-get update && apt-get install -y libnss3

# Copy built app files from the builder stage
COPY --from=builder /app/dist ./dist/

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))" || exit 1

# Set command
CMD ["node", "dist/cli.js", "--ws-endpoint", "ws://browserless:3000", "--port", "3000", "--remote"]
