#!/usr/bin/env node

// Import SDK modules
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ToolDefinition } from "@modelcontextprotocol/sdk";

// Import node modules
import path from 'path';
import os from 'os';
import { URL } from 'url';
import debug from 'debug/dist/debug.js';
import express from 'express';

// Import browser controller modules
import { BrowserController } from './src/browserController.js';
import { getBrowserConfig, isAllowedDomain, sanitizeScript, withTimeout } from "./src/utils/browserConfig.js";
import { connectWithRetry, setupPageErrorHandlers, createPage } from "./src/utils/browserConnection.js";
import { generateAccessibilitySnapshot } from "./src/utils/accessibilitySnapshot.js";

// Create debug loggers
const logServer = debug('mcp-puppeteer:server');
const logBrowser = debug('mcp-puppeteer:browser');
const logConnection = debug('mcp-puppeteer:connection');
const logNavigation = debug('mcp-puppeteer:navigation');
const logError = debug('mcp-puppeteer:error');
const logTool = debug('mcp-puppeteer:tool');

// Constants
const MAX_SCREENSHOTS = 50;
const MAX_PAGES = 10;

// Types
type NavigateParams = {
  url: string;
  wait_for?: string;
  timeout_ms?: number;
};

type ScrollParams = {
  direction: 'up' | 'down' | 'left' | 'right';
  pixels?: number;
  selector?: string;
  wait_for?: string;
  timeout_ms?: number;
};

type ClickParams = {
  selector: string;
  wait_for?: string;
  timeout_ms?: number;
};

type TypeParams = {
  selector: string;
  text: string;
  delay?: number;
  wait_for?: string;
  timeout_ms?: number;
};

type ExtractParams = {
  selector?: string;
};

type ScreenshotParams = {
  path?: string;
  fullPage?: boolean;
  quality?: number;
  type?: 'jpeg' | 'png';
  selector?: string;
  return_base64?: boolean;
};

type ScriptParams = {
  code: string;
  args?: any[];
  timeout_ms?: number;
};

// Initialize browser controller
let browserController: BrowserController | null = null;
try {
  browserController = new BrowserController();
  logServer('BrowserController initialized');
} catch (error) {
  logError('Failed to initialize BrowserController: %O', error);
  process.exit(1);
}

// Tool handlers
const navigateHandler = async (params: NavigateParams) => {
  logTool('Handling navigate to URL: %s', params.url);
  if (!browserController) throw new Error("Browser not initialized");

  try {
    return await browserController.navigate(params.url, params.wait_for, params.timeout_ms);
  } catch (error: any) {
    logError('Navigation failed: %O', error);
    throw new Error(`Navigation failed: ${error.message}`);
  }
};

const goBackHandler = async (params: { wait_for?: string; timeout_ms?: number }) => {
  logTool('Handling goBack');
  if (!browserController) throw new Error("Browser not initialized");

  try {
    return await browserController.goBack(params.wait_for, params.timeout_ms);
  } catch (error: any) {
    logError('Go back failed: %O', error);
    throw new Error(`Go back failed: ${error.message}`);
  }
};

const goForwardHandler = async (params: { wait_for?: string; timeout_ms?: number }) => {
  logTool('Handling goForward');
  if (!browserController) throw new Error("Browser not initialized");

  try {
    return await browserController.goForward(params.wait_for, params.timeout_ms);
  } catch (error: any) {
    logError('Go forward failed: %O', error);
    throw new Error(`Go forward failed: ${error.message}`);
  }
};

const scrollHandler = async (params: ScrollParams) => {
  logTool('Handling scroll: %s', params.direction);
  if (!browserController) throw new Error("Browser not initialized");

  try {
    return await browserController.scroll(params.direction, params.pixels, params.selector, params.wait_for, params.timeout_ms);
  } catch (error: any) {
    logError('Scroll failed: %O', error);
    throw new Error(`Scroll failed: ${error.message}`);
  }
};

const clickHandler = async (params: ClickParams) => {
  logTool('Handling click: %s', params.selector);
  if (!browserController) throw new Error("Browser not initialized");

  try {
    return await browserController.click(params.selector, params.wait_for, params.timeout_ms);
  } catch (error: any) {
    logError('Click failed: %O', error);
    throw new Error(`Click failed: ${error.message}`);
  }
};

const typeHandler = async (params: TypeParams) => {
  logTool('Handling type: %s', params.selector);
  if (!browserController) throw new Error("Browser not initialized");

  try {
    return await browserController.type(params.selector, params.text, params.delay, params.wait_for, params.timeout_ms);
  } catch (error: any) {
    logError('Type failed: %O', error);
    throw new Error(`Type failed: ${error.message}`);
  }
};

const extractTextHandler = async (params: ExtractParams) => {
  logTool('Handling extractText: %s', params.selector || 'body');
  if (!browserController) throw new Error("Browser not initialized");

  try {
    return await browserController.extractText(params.selector);
  } catch (error: any) {
    logError('Extract text failed: %O', error);
    throw new Error(`Extract text failed: ${error.message}`);
  }
};

const extractHyperlinksHandler = async (params: ExtractParams) => {
  logTool('Handling extractHyperlinks: %s', params.selector || 'body');
  if (!browserController) throw new Error("Browser not initialized");

  try {
    return await browserController.extractHyperlinks(params.selector);
  } catch (error: any) {
    logError('Extract hyperlinks failed: %O', error);
    throw new Error(`Extract hyperlinks failed: ${error.message}`);
  }
};

const takeScreenshotHandler = async (params: ScreenshotParams) => {
  logTool('Handling takeScreenshot');
  if (!browserController) throw new Error("Browser not initialized");

  try {
    return await browserController.takeScreenshot(params.path, params.fullPage, params.quality, params.type, params.selector, params.return_base64);
  } catch (error: any) {
    logError('Take screenshot failed: %O', error);
    throw new Error(`Take screenshot failed: ${error.message}`);
  }
};

const executeScriptHandler = async (params: ScriptParams) => {
  logTool('Handling executeScript');
  if (!browserController) throw new Error("Browser not initialized");

  try {
    const result = await browserController.executeScript(params.code, params.args, params.timeout_ms);
    return { result };
  } catch (error: any) {
    logError('Execute script failed: %O', error);
    throw new Error(`Script execution failed: ${error.message}`);
  }
};

const accessibilitySnapshotHandler = async () => {
  logTool('Handling accessibility/snapshot');
  if (!browserController) throw new Error("Browser not initialized");
  
  const page = browserController.getCurrentPage();
  if (!page) throw new Error("No active page found");
  
  return await generateAccessibilitySnapshot(page);
};

// Create the server with all tools
const server = new Server({
  name: "mcp-puppeteer",
  version: "0.1.0",
  tools: [
    {
      name: "browser/navigate",
      description: "Navigate to a URL",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to navigate to" },
          wait_for: { type: "string", description: "Wait until this condition is met (load|domcontentloaded|networkidle0|networkidle2)", default: "load" },
          timeout_ms: { type: "integer", description: "Timeout in milliseconds", default: 30000 }
        },
        required: ["url"]
      },
      outputSchema: { type: "object", properties: { message: { type: "string" } } },
      handler: navigateHandler
    },
    {
      name: "browser/back",
      description: "Navigate back in history",
      inputSchema: {
        type: "object",
        properties: {
          wait_for: { type: "string", description: "Wait until this condition is met (load|domcontentloaded|networkidle0|networkidle2)", default: "load" },
          timeout_ms: { type: "integer", description: "Timeout in milliseconds", default: 30000 }
        }
      },
      outputSchema: { type: "object", properties: { message: { type: "string" } } },
      handler: goBackHandler
    },
    {
      name: "browser/forward",
      description: "Navigate forward in history",
      inputSchema: {
        type: "object",
        properties: {
          wait_for: { type: "string", description: "Wait until this condition is met (load|domcontentloaded|networkidle0|networkidle2)", default: "load" },
          timeout_ms: { type: "integer", description: "Timeout in milliseconds", default: 30000 }
        }
      },
      outputSchema: { type: "object", properties: { message: { type: "string" } } },
      handler: goForwardHandler
    },
    {
      name: "browser/scroll",
      description: "Scroll the page in a specified direction",
      inputSchema: {
        type: "object",
        properties: {
          direction: { type: "string", description: "Direction to scroll (up|down|left|right)", enum: ["up", "down", "left", "right"] },
          pixels: { type: "integer", description: "Number of pixels to scroll", default: 500 },
          selector: { type: "string", description: "Selector to scroll within (optional)" },
          wait_for: { type: "string", description: "Wait until this condition is met after scrolling (none|load|domcontentloaded|networkidle0|networkidle2)", default: "none" },
          timeout_ms: { type: "integer", description: "Timeout in milliseconds for wait_for", default: 30000 }
        },
        required: ["direction"]
      },
      outputSchema: { type: "object", properties: { message: { type: "string" } } },
      handler: scrollHandler
    },
    {
      name: "browser/click",
      description: "Click on an element",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector for the element to click" },
          wait_for: { type: "string", description: "Wait until this condition is met after clicking (none|load|domcontentloaded|networkidle0|networkidle2)", default: "none" },
          timeout_ms: { type: "integer", description: "Timeout in milliseconds for wait_for", default: 30000 }
        },
        required: ["selector"]
      },
      outputSchema: { type: "object", properties: { message: { type: "string" } } },
      handler: clickHandler
    },
    {
      name: "browser/type",
      description: "Type text into an input field",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector for the input field" },
          text: { type: "string", description: "Text to type" },
          delay: { type: "integer", description: "Delay between keystrokes in milliseconds", default: 0 },
          wait_for: { type: "string", description: "Wait until this condition is met after typing (none|load|domcontentloaded|networkidle0|networkidle2)", default: "none" },
          timeout_ms: { type: "integer", description: "Timeout in milliseconds for wait_for", default: 30000 }
        },
        required: ["selector", "text"]
      },
      outputSchema: { type: "object", properties: { message: { type: "string" } } },
      handler: typeHandler
    },
    {
      name: "content/extract_text",
      description: "Extract text content from the current page",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector to extract text from (defaults to body)" }
        },
        required: []
      },
      outputSchema: { type: "object", properties: { text: { type: "string" } } },
      handler: extractTextHandler
    },
    {
      name: "content/extract_hyperlinks",
      description: "Extract hyperlinks from the current page",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector to extract hyperlinks from (defaults to body)" }
        },
        required: []
      },
      outputSchema: {
        type: "object",
        properties: {
          hyperlinks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                href: { type: "string" },
                text: { type: "string" }
              }
            }
          }
        }
      },
      handler: extractHyperlinksHandler
    },
    {
      name: "screenshot/take",
      description: "Take a screenshot of the current page",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to save the screenshot to" },
          fullPage: { type: "boolean", description: "Whether to take a screenshot of the full page or just the viewport", default: false },
          quality: { type: "integer", description: "Quality of the screenshot (0-100, only for JPEG)", default: 80 },
          type: { type: "string", description: "Image type (jpeg|png)", enum: ["jpeg", "png"], default: "png" },
          selector: { type: "string", description: "CSS selector to take screenshot of (optional)" },
          return_base64: { type: "boolean", description: "Whether to return the screenshot as a base64 string", default: false }
        },
        required: []
      },
      outputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          base64: { type: "string" },
          message: { type: "string" }
        }
      },
      handler: takeScreenshotHandler
    },
    {
      name: "script/execute",
      description: "Executes JavaScript code in the context of the current page.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "The JavaScript code to execute." },
          args: { type: "array", description: "Optional arguments to pass to the script.", default: [] },
          timeout_ms: { type: "integer", description: "Timeout in milliseconds.", default: 30000 }
        },
        required: ["code"]
      },
      outputSchema: { type: "object", properties: { result: {} } },
      handler: executeScriptHandler
    },
    {
      name: "accessibility/snapshot",
      description: "Generates an accessibility snapshot (tree) of the current page content.",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object" },
      handler: accessibilitySnapshotHandler
    }
  ]
});

logServer('Server instance created with tools');

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
  logServer(`Received ${signal}. Shutting down gracefully...`);
  if (browserController) {
    logServer("Closing browser connection...");
    await browserController.close();
    logServer("Browser connection closed.");
  }
  logServer("Exiting process.");
  process.exit(0);
}

// Register signal handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Create Express app for SSE
const app = express();
const port = process.env.PORT || 3000;

// Set up SSE endpoint
app.get('/sse', async (req, res) => {
  logServer('Client connected to SSE endpoint');
  
  try {
    const transport = new SSEServerTransport(req, res);
    await server.connect(transport);
    logServer('Server connected to client via SSE');
  } catch (error) {
    logError('Error connecting server to SSE transport: %O', error);
    if (!res.headersSent) {
      res.status(500).end();
    }
  }
  
  req.on('close', () => {
    logServer('Client disconnected from SSE endpoint');
  });
});

// Set up message endpoint for receiving client messages
app.post('/messages', express.json(), async (req, res) => {
  logServer('Received message: %O', req.body);
  
  try {
    res.json({ status: 'received' });
  } catch (error: any) {
    logError('Error processing message: %O', error);
    res.status(500).json({ error: error.message });
  }
});

// Add a simple status endpoint
app.get('/', (req, res) => {
  res.send('MCP Puppeteer Server is running. Connect to /sse for Server-Sent Events.');
});

// Start Express server
app.listen(port, () => {
  logServer(`Express server listening on port ${port}`);
  logServer(`SSE endpoint available at http://localhost:${port}/sse`);
  logServer(`Messages endpoint available at http://localhost:${port}/messages`);
});

// Keep-alive interval for debugging
const KEEP_ALIVE_INTERVAL = 60000; // 1 minute
setInterval(() => {
  logServer("Server still running (keep-alive)");
}, KEEP_ALIVE_INTERVAL);
