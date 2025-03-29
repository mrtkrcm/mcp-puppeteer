FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Skip Chrome download since we're using a remote browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Copy app files
COPY dist/ ./dist/

# Expose port
EXPOSE 3001

# Set command
CMD ["node", "dist/cli.js", "--ws-endpoint", "ws://browserless:3000", "--port", "3001"]
