#!/usr/bin/env node
import { startServer } from './index.js';

// Parse command line arguments
const args = process.argv.slice(2);
const options = {};

// Handle command line arguments
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ws-endpoint' || args[i] === '-w') {
    if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
      options.browserWSEndpoint = args[i + 1];
      i++; // Skip the next argument
    }
  } else if (args[i] === '--port' || args[i] === '-p') {
    if (i + 1 < args.length) {
      options.port = parseInt(args[i + 1], 10);
      i++; // Skip the next argument
    }
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
MCP Puppeteer CLI

Usage:
  mcp-puppeteer [options]

Options:
  --ws-endpoint, -w <url>  WebSocket endpoint for remote browser (e.g., ws://localhost:3000)
  --port, -p <port>        Port to run the server on (default: 3001)
  --help, -h               Show this help message
    `);
    process.exit(0);
  }
}

// Set defaults
if (!options.port) {
  options.port = 3001;
}

console.log('Starting MCP Puppeteer server with options:', JSON.stringify(options, null, 2));

// Start the server
startServer(options)
  .then(() => {
    console.log('MCP Puppeteer server started successfully');
  })
  .catch(error => {
    console.error('Failed to start MCP Puppeteer server:', error);
    process.exit(1);
  });
