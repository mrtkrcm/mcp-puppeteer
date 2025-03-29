// Minimal MCP Server test
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import debug from 'debug';

// Enable all debug logs
process.env.DEBUG = '*';

// Create debug logger
const log = debug('test-mcp-server');

// Log at the very start
console.error(">>> Script starting");

// Create a minimal server
const server = new Server({
  name: "test-mcp-server",
  version: "1.0.0",
  tools: [
    {
      name: "test/echo",
      description: "Echo back the input",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string" }
        },
        required: ["message"]
      },
      outputSchema: {
        type: "object",
        properties: {
          message: { type: "string" }
        }
      },
      handler: async (params) => {
        console.error(`>>> Echo tool called with: ${params.message}`);
        return { message: params.message };
      }
    }
  ]
});

console.error(">>> Server instance created with tools");

// Start the server with stdio transport
async function runServer() {
  console.error(">>> Creating StdioServerTransport");
  const transport = new StdioServerTransport();
  
  console.error(">>> Connecting server to transport");
  try {
    await server.connect(transport);
    console.error(">>> Server connected successfully");
  } catch (error) {
    console.error(">>> Error connecting server:", error);
    process.exit(1);
  }
}

console.error(">>> Calling runServer()");
runServer().catch(error => {
  console.error(">>> Error in runServer():", error);
  process.exit(1);
});

// Keep the process alive
setInterval(() => {
  console.error(">>> Server still running (keep-alive)");
}, 10000);

console.error(">>> Script reached end, waiting for connections");
