import puppeteer from 'puppeteer';
import { generateAccessibilitySnapshot } from './browser/snapshot.js';
import http from 'http';
import debug from 'debug';

// Create debug loggers with different namespaces
const logServer = debug('mcp-puppeteer:server');
const logBrowser = debug('mcp-puppeteer:browser');
const logConnection = debug('mcp-puppeteer:connection');
const logNavigation = debug('mcp-puppeteer:navigation');
const logError = debug('mcp-puppeteer:error');
const logSSE = debug('mcp-puppeteer:sse');

// Track connected SSE clients
const sseClients = new Set();
const sseDebug = debug('mcp-puppeteer:sse');

// Keep-alive interval (15 seconds)
const KEEP_ALIVE_INTERVAL = 15000;

/**
 * Start the MCP Puppeteer server
 * @param {Object} options - Server options
 * @param {number} options.port - Port to run the server on (default: 3000)
 * @param {string} options.browserWSEndpoint - Browser WebSocket endpoint
 * @param {boolean} options.useBrowserless - Whether to use browserless.io
 * @param {string} options.host - Host to bind to (default: localhost)
 * @param {boolean} options.isRemoteMode - Whether to run in remote mode
 * @returns {Promise<Object>} - Server and browser objects
 */
export async function startServer(options = {}) {
  const port = options.port || 3000;
  const host = options.host || 'localhost';
  const browserConfig = {};

  // Configure browser connection
  if (options.useBrowserless) {
    const browserlessEndpoint = options.browserWSEndpoint || 'ws://localhost:3000';
    logConnection('Connecting to browserless endpoint: %s', browserlessEndpoint);
    browserConfig.browserWSEndpoint = browserlessEndpoint;
  } else if (options.browserWSEndpoint) {
    logConnection('Connecting to browser WebSocket endpoint: %s', options.browserWSEndpoint);
    browserConfig.browserWSEndpoint = options.browserWSEndpoint;
  } else if (process.env.PUPPETEER_BROWSER_WS_ENDPOINT) {
    logConnection('Using PUPPETEER_BROWSER_WS_ENDPOINT: %s', process.env.PUPPETEER_BROWSER_WS_ENDPOINT);
    browserConfig.browserWSEndpoint = process.env.PUPPETEER_BROWSER_WS_ENDPOINT;
  } else if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    logConnection('Using PUPPETEER_EXECUTABLE_PATH: %s', process.env.PUPPETEER_EXECUTABLE_PATH);
    browserConfig.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  // Standard browser config options
  browserConfig.headless = 'new';
  browserConfig.args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu'
  ];

  logBrowser('Starting browser with config: %O', browserConfig);

  // Launch browser
  let browser;
  try {
    browser = await puppeteer.launch(browserConfig);
    logBrowser('Browser launched successfully');
    broadcastSseEvent('browser_status', { status: 'connected' });

    // Get and log browser version info to confirm connection
    const version = await browser.version();
    logBrowser('Connected to browser: %s', version);
    broadcastSseEvent('browser_info', { version });

    // Log browser endpoint to confirm where we're connected
    if (browserConfig.browserWSEndpoint) {
      logConnection('Confirmed connection to endpoint: %s', browserConfig.browserWSEndpoint);
      broadcastSseEvent('connection_info', { endpoint: browserConfig.browserWSEndpoint });

      // Track browser disconnection events
      browser.on('disconnected', () => {
        logError('Browser disconnected from WebSocket endpoint');
        broadcastSseEvent('browser_status', { status: 'disconnected' });
        // Attempt to reconnect
        logConnection('Attempting to reconnect...');
      });
    } else {
      logConnection('Using local browser instance');
      broadcastSseEvent('connection_info', { type: 'local' });
    }

    // Get browser target count to verify multiple pages
    const targets = await browser.targets();
    const pages = targets.filter(target => target.type() === 'page');
    logBrowser('Browser has %d page(s) open', pages.length);
    broadcastSseEvent('browser_pages', { count: pages.length });

    // Track new targets for debugging
    browser.on('targetcreated', async (target) => {
      if (target.type() === 'page') {
        const url = await target.url();
        logNavigation('New page created on remote browser: %s', url);
        broadcastSseEvent('page_created', { url });
      }
    });

    logServer('MCP Puppeteer server started successfully');
    broadcastSseEvent('server_status', { status: 'running' });
  } catch (err) {
    logError('Failed to launch browser: %O', err);
    broadcastSseEvent('browser_status', { status: 'error', message: err.message });
    throw err;
  }

  // Create a simple HTTP server
  const server = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // Handle SSE subscription endpoint
    if (pathname === '/events') {
      setupSseConnection(res);
    } else if (pathname === '/health') {
      logServer('Health check requested');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        browser: 'connected',
        browserVersion: await browser.version(),
        usingRemote: !!browserConfig.browserWSEndpoint,
        remoteEndpoint: browserConfig.browserWSEndpoint || null
      }));
    } else if (pathname === '/test-connection' && req.method === 'GET') {
      logServer('Test connection requested');
      try {
        // Create a test page to verify browser connection
        const page = await browser.newPage();
        logNavigation('Created test page for connection test');
        broadcastSseEvent('page_action', { action: 'created', purpose: 'connection_test' });

        try {
          // Navigate to a simple test URL
          logNavigation('Navigating to example.com for connection test');
          broadcastSseEvent('page_action', { action: 'navigating', url: 'https://example.com' });

          const response = await page.goto('https://example.com', { waitUntil: 'networkidle0' });

          // Get the page title to verify browser functionality
          const title = await page.title();
          logNavigation('Page loaded with title: %s', title);

          // Get the HTML content length to verify content retrieval
          const content = await page.content();
          logNavigation('Retrieved content length: %d bytes', content.length);

          broadcastSseEvent('page_action', {
            action: 'loaded',
            url: 'https://example.com',
            title,
            contentLength: content.length
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            title,
            status: response.status(),
            contentLength: content.length,
            browserEndpoint: browserConfig.browserWSEndpoint || 'local'
          }));
        } catch (error) {
          logError('Test connection navigation error: %O', error);
          broadcastSseEvent('page_error', { type: 'navigation', message: error.message });

          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: error.message,
            stack: error.stack,
            browserEndpoint: browserConfig.browserWSEndpoint || 'local'
          }));
        } finally {
          await page.close();
          logNavigation('Closed test page');
          broadcastSseEvent('page_action', { action: 'closed', purpose: 'connection_test' });
        }
      } catch (error) {
        logError('Test connection page creation error: %O', error);
        broadcastSseEvent('page_error', { type: 'creation', message: error.message });

        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: error.message,
          type: 'browser-connection-error',
          browserEndpoint: browserConfig.browserWSEndpoint || 'local'
        }));
      }
    } else if (pathname === '/snapshot' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const targetUrl = data.url || 'about:blank';
          logServer('Snapshot requested for URL: %s', targetUrl);
          broadcastSseEvent('snapshot_request', { url: targetUrl });

          const page = await browser.newPage();
          logNavigation('Created new page for snapshot');
          broadcastSseEvent('page_action', { action: 'created', purpose: 'snapshot', url: targetUrl });

          try {
            // Navigate to the URL
            logNavigation('Navigating to: %s', targetUrl);
            broadcastSseEvent('page_action', { action: 'navigating', url: targetUrl });

            const response = await page.goto(targetUrl, { waitUntil: 'networkidle0' });

            // Log response details to verify the request went through the remote browser
            logNavigation('Page loaded: %d %s', response.status(), response.statusText());
            logNavigation('Page URL: %s', page.url());
            broadcastSseEvent('page_action', {
              action: 'loaded',
              url: targetUrl,
              status: response.status(),
              statusText: response.statusText()
            });

            const snapshot = await generateAccessibilitySnapshot(page);
            logNavigation('Generated snapshot with size: %d bytes', snapshot.length);
            broadcastSseEvent('snapshot_generated', {
              url: targetUrl,
              size: snapshot.length
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ snapshot }));
          } catch (error) {
            logError('Error generating snapshot: %O', error);
            broadcastSseEvent('snapshot_error', {
              url: targetUrl,
              message: error.message
            });

            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
          } finally {
            await page.close();
            logNavigation('Closed snapshot page');
            broadcastSseEvent('page_action', { action: 'closed', purpose: 'snapshot' });
          }
        } catch (error) {
          logError('Invalid request: %O', error);
          broadcastSseEvent('request_error', { message: error.message });

          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request' }));
        }
      });
    } else {
      logServer('Unknown route requested: %s %s', req.method, pathname);
      res.writeHead(404);
      res.end();
    }
  });

  // Start server
  server.listen(port, host, () => {
    const serverUrl = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
    logServer('MCP Puppeteer server listening on %s (%s)', `${host}:${port}`, serverUrl);
    broadcastSseEvent('server_status', {
      status: 'listening',
      host: host,
      port: port,
      isRemote: options.isRemoteMode,
      endpoint: serverUrl
    });
  });

  // Handle cleanup on exit
  const cleanup = async () => {
    logServer('Shutting down server and browser...');
    broadcastSseEvent('server_status', { status: 'shutting_down' });

    // Close all SSE connections
    for (const client of sseClients) {
      client.end();
    }
    sseClients.clear();

    server.close();
    await browser.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return { server, browser };
}

function setupSseConnection(res) {
    sseDebug('New SSE client connected');

    // SSE Setup
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    // Send initial connection event
    const connectionEvent = {
        event: 'connected',
        timestamp: Date.now()
    };
    res.write(`data: ${JSON.stringify(connectionEvent)}\n\n`);

    // Setup keep-alive
    const keepAliveInterval = setInterval(() => {
        res.write(`: keep-alive\n\n`);
    }, KEEP_ALIVE_INTERVAL);

    // Add to clients set
    sseClients.add(res);

    // Handle client disconnect
    res.on('close', () => {
        clearInterval(keepAliveInterval);
        sseClients.delete(res);
        sseDebug('SSE client disconnected');
    });
}

function broadcastSseEvent(event, data) {
    if (sseClients.size === 0) return;

    const eventString = `data: ${JSON.stringify(data)}\nevent: ${event}\n\n`;

    sseClients.forEach(client => {
        try {
            client.write(eventString);
        } catch (err) {
            sseDebug('Error broadcasting to client:', err);
            sseClients.delete(client);
        }
    });
}
