import puppeteer from 'puppeteer';
import { generateAccessibilitySnapshot } from './browser/snapshot.js';
import { findElementByRefId, findElementInPage, getAllFrameTrees } from './browser/elementLocator.js';
import http from 'http';

/**
 * Start the MCP Puppeteer server
 * @param {Object} options - Server options
 * @param {number} options.port - Port to run the server on (default: 3001)
 * @param {string} options.browserWSEndpoint - Browser WebSocket endpoint
 * @returns {Promise<void>}
 */
export async function startServer(options = {}) {
  const port = options.port || 3001;
  const browserConfig = {};

  // Configure browser connection
  if (options.browserWSEndpoint) {
    console.log(`Connecting to browser WebSocket endpoint: ${options.browserWSEndpoint}`);
    browserConfig.browserWSEndpoint = options.browserWSEndpoint;
  } else if (process.env.PUPPETEER_BROWSER_WS_ENDPOINT) {
    console.log(`Using PUPPETEER_BROWSER_WS_ENDPOINT: ${process.env.PUPPETEER_BROWSER_WS_ENDPOINT}`);
    browserConfig.browserWSEndpoint = process.env.PUPPETEER_BROWSER_WS_ENDPOINT;
  } else if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    console.log(`Using PUPPETEER_EXECUTABLE_PATH: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
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

  console.log('Starting browser with config:', JSON.stringify(browserConfig, null, 2));

  // Launch browser
  const browser = await puppeteer.launch(browserConfig);
  console.log('Browser launched successfully');

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

    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', browser: 'connected' }));
    } else if (req.url === '/snapshot' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const page = await browser.newPage();

          try {
            console.log(`Navigating to: ${data.url || 'about:blank'}`);
            await page.goto(data.url || 'about:blank', { waitUntil: 'networkidle0' });
            const snapshot = await generateAccessibilitySnapshot(page);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ snapshot }));
          } catch (error) {
            console.error('Error generating snapshot:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
          } finally {
            await page.close();
          }
        } catch (error) {
          console.error('Invalid request:', error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request' }));
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  // Start server
  server.listen(port, () => {
    console.log(`MCP Puppeteer server listening on port ${port}`);
  });

  // Handle cleanup on exit
  const cleanup = async () => {
    console.log('Shutting down server and browser...');
    server.close();
    await browser.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return { server, browser };
}
