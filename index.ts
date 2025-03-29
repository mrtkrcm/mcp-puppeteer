#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  CallToolResult,
  TextContent,
  ImageContent,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import puppeteer, { Browser, Page } from "puppeteer";
import { LRUCache } from "./src/utils/LRUCache.js";
import { getBrowserConfig, isAllowedDomain, sanitizeScript, withTimeout } from "./src/utils/browserConfig.js";
import { connectWithRetry, setupPageErrorHandlers, createPage } from "./src/utils/browserConnection.js";
import { generateAccessibilitySnapshot } from "./src/utils/accessibilitySnapshot.js";
import debug from 'debug';

// Create debug loggers with different namespaces
const logServer = debug('mcp-puppeteer:server');
const logBrowser = debug('mcp-puppeteer:browser');
const logConnection = debug('mcp-puppeteer:connection');
const logNavigation = debug('mcp-puppeteer:navigation');
const logError = debug('mcp-puppeteer:error');

// Constants for resource limits
const MAX_SCREENSHOTS = 50;
const MAX_CONSOLE_LOGS = 1000;
const DEFAULT_TIMEOUT = 30000;

// Define the tools once to avoid repetition
const TOOLS: Tool[] = [
  {
    name: "browser_snapshot",
    description: "Capture accessibility snapshot of the current page for better element targeting",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "puppeteer_navigate",
    description: "Navigate to a URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
      },
      required: ["url"],
    },
  },
  {
    name: "puppeteer_screenshot",
    description: "Take a screenshot of the current page or a specific element",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for the screenshot" },
        selector: { type: "string", description: "CSS selector for element to screenshot" },
        width: { type: "number", description: "Width in pixels (default: 800)" },
        height: { type: "number", description: "Height in pixels (default: 600)" },
      },
      required: ["name"],
    },
  },
  {
    name: "puppeteer_click",
    description: "Click an element on the page",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for element to click" },
      },
      required: ["selector"],
    },
  },
  {
    name: "puppeteer_fill",
    description: "Fill out an input field",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for input field" },
        value: { type: "string", description: "Value to fill" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "puppeteer_select",
    description: "Select an element on the page with Select tag",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for element to select" },
        value: { type: "string", description: "Value to select" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "puppeteer_hover",
    description: "Hover an element on the page",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for element to hover" },
      },
      required: ["selector"],
    },
  },
  {
    name: "puppeteer_evaluate",
    description: "Execute JavaScript in the browser console",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", description: "JavaScript code to execute" },
      },
      required: ["script"],
    },
  },
];

// Global state
let browser: Browser | undefined;
let page: Page | undefined;
const consoleLogs: string[] = [];
const screenshots = new LRUCache<string, string>(MAX_SCREENSHOTS);

async function ensureBrowser(): Promise<Page> {
  if (!browser || !browser.isConnected()) {
    logConnection('Attempting to establish browser connection...');
    browser = undefined;
    page = undefined;
    screenshots.clear();
    consoleLogs.length = 0;

    const config = getBrowserConfig();
    const endpoint = process.env.PUPPETEER_BROWSER_WS_ENDPOINT;

    if (endpoint) {
      try {
        browser = await connectWithRetry(endpoint);
        logConnection('Connected to existing browser instance.');

        browser.on('disconnected', () => {
          logError('Browser disconnected unexpectedly.');
          browser = undefined;
          page = undefined;
          // Attempt reconnection in background
          setTimeout(() => ensureBrowser().catch(err => logError('Reconnection error: %O', err)), 1000);
        });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logError('Failed to connect to browser: %s', errMsg);
        if (process.env.FALLBACK_TO_LOCAL_CHROME === 'false') {
          throw new Error(`Could not connect to browser and fallback is disabled.`);
        }
        logConnection('Connect failed, attempting fallback to local launch...');
      }
    }

    if (!browser) {
      try {
        logBrowser('Launching new local browser instance...');
        const launchConfig = getBrowserConfig();
        browser = await puppeteer.launch(launchConfig as any);
        logBrowser('Local browser launched.');

        browser.on('disconnected', () => {
          logError('Local browser instance closed unexpectedly.');
          browser = undefined;
          page = undefined;
        });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logError('Failed to launch local browser instance: %s', errMsg);
        throw new Error('Failed to initialize browser session.');
      }
    }

    try {
      page = await createPage(browser);
      setupPageErrorHandlers(page, consoleLogs);
      logBrowser('Browser page ready.');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logError('Failed to get or configure browser page: %s', errMsg);
      if (browser) await browser.close().catch(e => logError("Error closing browser after page failure: %O", e));
      browser = undefined;
      throw new Error("Failed to initialize browser page.");
    }
  } else if (!page || page.isClosed()) {
    logBrowser('Page was closed or invalid, opening a new one...');
    try {
      page = await createPage(browser);
      setupPageErrorHandlers(page, consoleLogs);
      logBrowser('New browser page ready.');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logError('Failed to open new page: %s', errMsg);
      page = undefined;
      throw new Error("Failed to open new browser page.");
    }
  }

  if (!page || page.isClosed()) {
    throw new Error("Failed to obtain a valid browser page.");
  }

  return page;
}

// Define handleToolCall function properly
async function handleToolCall(name: string, args: any): Promise<CallToolResult> {
  const page = await ensureBrowser();

  switch (name) {
    case "browser_snapshot": {
      try {
        const snapshot = await generateAccessibilitySnapshot(page);
        const pageUrl = page.url();
        const pageTitle = await page.title();

        const lines = [
          `- Page URL: ${pageUrl}`,
          `- Page Title: ${pageTitle}`,
          `- Page Snapshot`,
          '```yaml',
          snapshot,
          '```',
        ];

        return {
          content: [{
            type: "text",
            text: lines.join('\n')
          }],
          isError: false,
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Failed to capture accessibility snapshot: ${errMsg}` }],
          isError: true,
        };
      }
    }

    case "puppeteer_navigate": {
      const url = args.url;
      if (!isAllowedDomain(url)) {
        return {
          content: [{ type: "text", text: `Navigation to ${url} is not allowed` }],
          isError: true,
        };
      }

      try {
        await withTimeout(
          page.goto(url),
          DEFAULT_TIMEOUT,
          `Navigation to ${url}`
        );
        return {
          content: [{ type: "text", text: `Navigated to ${url}` }],
          isError: false,
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Failed to navigate to ${url}: ${errMsg}` }],
          isError: true,
        };
      }
    }

    case "puppeteer_screenshot": {
      const width = args.width ?? 800;
      const height = args.height ?? 600;
      await page.setViewport({ width, height });

      try {
        const screenshotPromise = args.selector ?
          (async () => {
            const element = await page.$(args.selector);
            return element ? await element.screenshot({ encoding: "base64" }) : undefined;
          })() :
          page.screenshot({ encoding: "base64", fullPage: false });

        const screenshot = await withTimeout(
          screenshotPromise,
          DEFAULT_TIMEOUT,
          "Screenshot capture"
        );

        if (!screenshot) {
          return {
            content: [{
              type: "text",
              text: args.selector ? `Element not found: ${args.selector}` : "Screenshot failed",
            }],
            isError: true,
          };
        }

        screenshots.set(args.name, screenshot);

        try {
          setTimeout(() => {
            server.notification({
              method: "notifications/resources/list_changed",
            });
          }, 100);
        } catch (e) {
          logError("Failed to send notification: %O", e);
        }

        return {
          content: [
            {
              type: "text",
              text: `Screenshot '${args.name}' taken at ${width}x${height}`,
            } as TextContent,
            {
              type: "image",
              data: screenshot,
              mimeType: "image/png",
            } as ImageContent,
          ],
          isError: false,
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Screenshot capture failed: ${errMsg}` }],
          isError: true,
        };
      }
    }

    case "puppeteer_evaluate": {
      try {
        const script = sanitizeScript(args.script);
        const result = await withTimeout(
          page.evaluate(script),
          DEFAULT_TIMEOUT,
          "JavaScript evaluation"
        );

        return {
          content: [{
            type: "text",
            text: `Executed script successfully: ${JSON.stringify(result)}`,
          }],
          isError: false,
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Failed to execute script: ${errMsg}` }],
          isError: true,
        };
      }
    }

    case "puppeteer_click":
      try {
        await page.click(args.selector);
        return {
          content: [{
            type: "text",
            text: `Clicked: ${args.selector}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to click ${args.selector}: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    case "puppeteer_fill":
      try {
        await page.waitForSelector(args.selector);
        await page.type(args.selector, args.value);
        return {
          content: [{
            type: "text",
            text: `Filled ${args.selector} with: ${args.value}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to fill ${args.selector}: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    case "puppeteer_select":
      try {
        await page.waitForSelector(args.selector);
        await page.select(args.selector, args.value);
        return {
          content: [{
            type: "text",
            text: `Selected ${args.selector} with: ${args.value}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to select ${args.selector}: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    case "puppeteer_hover":
      try {
        await page.waitForSelector(args.selector);
        await page.hover(args.selector);
        return {
          content: [{
            type: "text",
            text: `Hovered ${args.selector}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to hover ${args.selector}: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Create server instance
const server = new Server(
  {
    name: "puppeteer",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Set up request handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      name: "console://logs",
      type: "text/plain",
    },
    ...Array.from(screenshots.keys()).map(name => ({
      name: `screenshot://${name}`,
      type: "image/png",
    })),
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (typeof request.params.name === 'string' && request.params.name === "console://logs") {
    return {
      content: [
        {
          type: "text",
          text: consoleLogs.join("\n"),
        },
      ],
    };
  }

  if (typeof request.params.name === 'string') {
    const match = request.params.name.match(/^screenshot:\/\/(.+)$/);
    if (match) {
      const screenshot = screenshots.get(match[1]);
      if (screenshot) {
        return {
          content: [
            {
              type: "image",
              data: screenshot,
              mimeType: "image/png",
            },
          ],
        };
      }
    }
  }

  throw new Error(`Resource not found: ${request.params.name}`);
});

server.setRequestHandler(CallToolRequestSchema, async (request) =>
  handleToolCall(request.params.name, request.params.arguments ?? {})
);

// Graceful shutdown handler
async function gracefulShutdown() {
  logServer('Shutting down server...');
  try {
    if (browser?.isConnected()) {
      logServer('Closing browser...');
      await browser.close();
      logServer('Browser closed.');
    }
  } catch (error) {
    logError('Error closing browser during shutdown: %O', error);
  } finally {
    await server.close();
    logServer('MCP server closed.');
    process.exit(0);
  }
}

// Handle signals for graceful shutdown
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Catch stdin closing for stdio mode
process.stdin.on("close", () => {
  const isStdioMode = !process.argv.includes('--sse');
  if (isStdioMode) {
    logServer("STDIN closed, initiating shutdown for stdio server.");
    gracefulShutdown();
  } else {
    logServer("STDIN closed, but not shutting down (SSE mode active).");
  }
});

// Start the server
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch(error => {
  logError("Server failed to start or encountered a fatal error: %O", error);
  process.exit(1);
});
