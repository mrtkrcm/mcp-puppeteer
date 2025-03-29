import puppeteer, { Browser, Page, ConsoleMessage } from 'puppeteer';
import { getBrowserConfig } from './browserConfig.js';
import debug from 'debug';

const logConnection = debug('mcp-puppeteer:connection');
const logError = debug('mcp-puppeteer:error');
const logNavigation = debug('mcp-puppeteer:navigation');

/**
 * Connect to a browser with retry logic
 * @param endpoint WebSocket endpoint
 * @param maxRetries Maximum number of retries
 * @returns Connected browser instance
 */
export async function connectWithRetry(endpoint: string, maxRetries = 3): Promise<Browser> {
  let retries = 0;
  let lastError: Error | undefined;

  while (retries <= maxRetries) {
    try {
      logConnection('Connection attempt %d/%d to %s', retries + 1, maxRetries + 1, endpoint);
      const browser = await puppeteer.connect({
        browserWSEndpoint: endpoint,
        protocolTimeout: 30000
      });
      return browser;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logError('Connection attempt %d failed: %s', retries + 1, lastError.message);

      if (retries < maxRetries) {
        // Exponential backoff
        const delay = Math.pow(2, retries) * 1000;
        logConnection('Retrying in %dms...', delay);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      retries++;
    }
  }

  throw lastError || new Error('Failed to connect to browser after retries');
}

/**
 * Set up event handlers for a page to capture errors and logs
 * @param page Puppeteer page
 * @param logs Array to store logs
 */
export function setupPageErrorHandlers(page: Page, logs: string[]): void {
  // Console messages
  page.on('console', (msg: ConsoleMessage) => {
    const logEntry = `[${msg.type()}] ${msg.text()}`;
    logs.push(logEntry);

    // Forward to appropriate debug logger
    if (msg.type() === 'error') {
      logError('Browser console: %s', msg.text());
    } else if (msg.type().toString() === 'warning') {
      logNavigation('Browser warning: %s', msg.text());
    } else {
      logNavigation('Browser log [%s]: %s', msg.type(), msg.text());
    }
  });

  // Page errors
  page.on('pageerror', error => {
    const logEntry = `[ERROR] Page error: ${error.message}`;
    logs.push(logEntry);
    logError('Page JavaScript error: %s', error.message);
  });

  // Request failures
  page.on('requestfailed', request => {
    const logEntry = `[NETWORK] Request failed: ${request.url()} - ${request.failure()?.errorText || 'Unknown error'}`;
    logs.push(logEntry);
    logError('Network request failed: %s - %s', request.url(), request.failure()?.errorText || 'Unknown error');
  });

  // Response errors (status >= 400)
  page.on('response', response => {
    const status = response.status();
    if (status >= 400) {
      const logEntry = `[NETWORK] Response error: ${response.url()} - Status ${status}`;
      logs.push(logEntry);
      logError('Network response error: %s - Status %d', response.url(), status);
    }
  });
}

/**
 * Create a new page with default configuration
 * @param browser Browser instance
 * @returns Configured page
 */
export async function createPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  const config = getBrowserConfig();

  // Apply viewport if specified
  if (config.defaultViewport) {
    await page.setViewport(config.defaultViewport);
    logNavigation('Set viewport: %dx%d', config.defaultViewport.width, config.defaultViewport.height);
  }

  // Apply user agent if specified
  if (config.userAgent) {
    await page.setUserAgent(config.userAgent);
    logNavigation('Set user agent: %s', config.userAgent);
  }

  return page;
}
