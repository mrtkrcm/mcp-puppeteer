#!/usr/bin/env node
import { startServer } from './index.js';
import debug from 'debug';

// Create debug loggers for CLI
const logCli = debug('mcp-puppeteer:cli');
const logError = debug('mcp-puppeteer:error');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {};
let debugEnabled = false;

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
  } else if (args[i] === '--debug' || args[i] === '-d') {
    debugEnabled = true;
    process.env.DEBUG = 'mcp-puppeteer:*';
    if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
      process.env.DEBUG = args[i + 1];
      i++; // Skip the next argument
    }
  } else if (args[i] === '--browserless') {
    options.useBrowserless = true;
    // If no explicit endpoint is provided, use a default one
    if (!options.browserWSEndpoint) {
      options.browserWSEndpoint = 'ws://localhost:3000';
    }
  } else if (args[i] === '--remote') {
    // Force remote mode - useful when deploying to servers
    options.isRemoteMode = true;
    if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
      // Optional remote host specification
      options.remoteHost = args[i + 1];
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
  --debug, -d [namespace]  Enable debug output (default: mcp-puppeteer:*)
  --browserless            Connect to a browserless.io instance (defaults to ws://localhost:3000)
  --remote [host]          Run in remote mode, optionally specifying the host to bind to
  --help, -h               Show this help message

Debug Namespaces:
  mcp-puppeteer:server     Server operations
  mcp-puppeteer:browser    Browser initialization and status
  mcp-puppeteer:connection Connection details
  mcp-puppeteer:navigation Page navigation and content
  mcp-puppeteer:sse        Server-Sent Events (SSE)
  mcp-puppeteer:error      Error reporting
    `);
    process.exit(0);
  }
}

// Set defaults
if (!options.port) {
  options.port = 3001;
}

// Handle remote mode
if (options.isRemoteMode) {
  // In remote mode, we want to bind to all interfaces unless specified
  options.host = options.remoteHost || '0.0.0.0';
  logCli('Running in remote mode, binding to %s', options.host);
}

// If debug was not enabled explicitly, set up minimal output
if (!debugEnabled) {
  // Enable only error logging by default
  process.env.DEBUG = 'mcp-puppeteer:error';
  // Use the debug logger for startup messages
  logCli('Starting MCP Puppeteer server with options: %O', options);
} else {
  logCli('Debug mode enabled: %s', process.env.DEBUG);
}

// Start the server
startServer(options)
  .then(({ server }) => {
    // Success is already logged by the server
  })
  .catch(error => {
    logError('Failed to start MCP Puppeteer server: %O', error);
    process.exit(1);
  });
