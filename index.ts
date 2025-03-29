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

// Constants for resource limits
const MAX_SCREENSHOTS = 50;
const MAX_CONSOLE_LOGS = 1000;
const DEFAULT_TIMEOUT = 30000;

// Define the tools once to avoid repetition
const TOOLS: Tool[] = [
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
    console.error('Attempting to establish browser connection...');
    browser = undefined;
    page = undefined;
    screenshots.clear();
    consoleLogs.length = 0;

    const config = getBrowserConfig();
    const endpoint = process.env.PUPPETEER_BROWSER_WS_ENDPOINT;

    if (endpoint) {
      try {
        browser = await connectWithRetry(endpoint);
        console.error('Connected to existing browser instance.');

        browser.on('disconnected', () => {
          console.error('Browser disconnected unexpectedly.');
          browser = undefined;
          page = undefined;
          // Attempt reconnection in background
          setTimeout(() => ensureBrowser().catch(console.error), 1000);
        });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`Failed to connect to browser: ${errMsg}`);
        if (process.env.FALLBACK_TO_LOCAL_CHROME === 'false') {
          throw new Error(`Could not connect to browser and fallback is disabled.`);
        }
        console.error('Connect failed, attempting fallback to local launch...');
      }
    }

    if (!browser) {
      try {
        console.error('Launching new local browser instance...');
        const launchConfig = getBrowserConfig();
        browser = await puppeteer.launch(launchConfig as any);
        console.error('Local browser launched.');

        browser.on('disconnected', () => {
          console.error('Local browser instance closed unexpectedly.');
          browser = undefined;
          page = undefined;
        });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`Failed to launch local browser instance: ${errMsg}`);
        throw new Error('Failed to initialize browser session.');
      }
    }

    try {
      page = await createPage(browser);
      setupPageErrorHandlers(page, consoleLogs);
      console.error('Browser page ready.');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`Failed to get or configure browser page: ${errMsg}`);
      if (browser) await browser.close().catch(e => console.error("Error closing browser after page failure:", e));
      browser = undefined;
      throw new Error("Failed to initialize browser page.");
    }
  } else if (!page || page.isClosed()) {
    console.error('Page was closed or invalid, opening a new one...');
    try {
      page = await createPage(browser);
      setupPageErrorHandlers(page, consoleLogs);
      console.error('New browser page ready.');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`Failed to open new page: ${errMsg}`);
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
          console.error("Failed to send notification:", e);
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
  console.error('\nShutting down server...');
  try {
    if (browser?.isConnected()) {
      console.error('Closing browser...');
      await browser.close();
      console.error('Browser closed.');
    }
  } catch (error) {
    console.error('Error closing browser during shutdown:', error);
  } finally {
    await server.close();
    console.error('MCP server closed.');
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
    console.error("STDIN closed, initiating shutdown for stdio server.");
    gracefulShutdown();
  } else {
    console.error("STDIN closed, but not shutting down (SSE mode active).");
  }
});

// Start the server
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch(error => {
  console.error("Server failed to start or encountered a fatal error:", error);
  process.exit(1);
});
