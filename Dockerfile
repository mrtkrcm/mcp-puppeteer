FROM node:20-slim

LABEL org.opencontainers.image.source=https://github.com/mrtkrcm/mcp-puppeteer
LABEL org.opencontainers.image.description="MCP Puppeteer - Remote Browser Automation Server"
LABEL org.opencontainers.image.licenses=MIT


WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Skip Chrome download since we're using a remote browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV DEBUG=mcp-puppeteer:*

# Copy app files
COPY dist/ ./dist/

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1), (e) => process.exit(1))" || exit 1

# Set command
CMD ["node", "dist/cli.js", "--ws-endpoint", "ws://browserless:3000", "--port", "3000", "--remote"]
