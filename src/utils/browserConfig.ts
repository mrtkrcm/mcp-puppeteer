import type { ConnectOptions, LaunchOptions, Viewport } from 'puppeteer';
import debug from 'debug';

const logError = debug('mcp-puppeteer:error');
const logBrowser = debug('mcp-puppeteer:browser');

export interface BrowserConfig {
  headless?: boolean | 'new';
  defaultViewport?: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
    isMobile?: boolean;
    hasTouch?: boolean;
    isLandscape?: boolean;
  } | null;
  slowMo?: number;
  userAgent?: string;
  timeout?: number;
  ignoreHTTPSErrors?: boolean;
  args?: string[];
}

export function getBrowserConfig(): BrowserConfig {
  const config: BrowserConfig = {
    headless: process.env.DOCKER_CONTAINER === 'true' ? true : 'new',
    defaultViewport: {
      width: parseInt(process.env.PUPPETEER_VIEWPORT_WIDTH || '1280', 10),
      height: parseInt(process.env.PUPPETEER_VIEWPORT_HEIGHT || '800', 10)
    },
    ignoreHTTPSErrors: true,
    args: []
  };

  // Add slowMo if specified
  if (process.env.PUPPETEER_SLOW_MO) {
    const slowMo = parseInt(process.env.PUPPETEER_SLOW_MO, 10);
    if (!isNaN(slowMo)) {
      config.slowMo = slowMo;
      logBrowser('Using slowMo: %dms', slowMo);
    }
  }

  // Add custom user agent if specified
  if (process.env.PUPPETEER_USER_AGENT) {
    config.userAgent = process.env.PUPPETEER_USER_AGENT;
    logBrowser('Using custom user agent: %s', config.userAgent);
  }

  // Add timeout if specified
  if (process.env.PUPPETEER_TIMEOUT) {
    const timeout = parseInt(process.env.PUPPETEER_TIMEOUT, 10);
    if (!isNaN(timeout)) {
      config.timeout = timeout;
      logBrowser('Using timeout: %dms', timeout);
    }
  }

  // Add Docker-specific arguments if running in Docker
  if (process.env.DOCKER_CONTAINER === 'true') {
    const extraArgs = ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--single-process", "--no-zygote"];
    config.args = [...(config.args || []), ...extraArgs];
    logBrowser('Added Docker-specific arguments to browser config');
  }

  // Parse and add custom arguments if specified
  if (process.env.PUPPETEER_ARGS) {
    try {
      const customArgs = JSON.parse(process.env.PUPPETEER_ARGS);
      if (Array.isArray(customArgs)) {
        config.args = [...(config.args || []), ...customArgs];
        logBrowser('Added custom args from PUPPETEER_ARGS: %O', customArgs);
      }
    } catch (e) {
      logError('Failed to parse PUPPETEER_ARGS: %O', e);
    }
  }

  return config;
}

export function isAllowedDomain(url: string): boolean {
  // Get allowed domains from environment variable
  const allowedDomains = (process.env.ALLOWED_DOMAINS || "").split(',').map(d => d.trim()).filter(Boolean);

  // If no allowed domains are specified, allow all
  if (allowedDomains.length === 0) return true;

  try {
    const urlObj = new URL(url);
    return allowedDomains.some(domain => {
      // Support wildcards (e.g., *.example.com)
      if (domain.startsWith('*.')) {
        const baseDomain = domain.substring(2);
        return urlObj.hostname.endsWith(baseDomain);
      }
      return urlObj.hostname === domain;
    });
  } catch (e) {
    logError('Invalid URL in isAllowedDomain check: %s', url);
    return false; // Invalid URL
  }
}

export function sanitizeScript(script: string): string {
  // Basic sanitization - more advanced approaches could be implemented
  const disallowedPatterns = [
    /process\s*\.\s*env/i,
    /require\s*\(/i,
    /eval\s*\(/i,
    /Function\s*\(/i,
    /document\.cookie/i
  ];

  const containsDisallowed = disallowedPatterns.some(pattern => pattern.test(script));
  if (containsDisallowed) {
    logError('Script contains potentially unsafe operations: %s', script.substring(0, 100) + (script.length > 100 ? '...' : ''));
    throw new Error("Script contains potentially unsafe operations");
  }

  return script;
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      logError('Operation timed out: %s (%dms)', operation, timeoutMs);
      reject(new Error(`Operation "${operation}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}
