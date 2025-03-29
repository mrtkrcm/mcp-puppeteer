// Transport connection test
console.error(">>> Script starting");

// Import specific modules from the SDK
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

console.error(">>> SDK imports successful");

// Create a server instance
const server = new Server({
  name: "test-server",
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

// Connect to transport
async function connectTransport() {
  try {
    console.error(">>> Creating StdioServerTransport");
    const transport = new StdioServerTransport();
    
    console.error(">>> Connecting server to transport");
    await server.connect(transport);
    console.error(">>> Server connected successfully");
  } catch (error) {
    console.error(">>> Error connecting to transport:", error);
  }
}

// Run the connection
connectTransport().catch(error => {
  console.error(">>> Unhandled error:", error);
});

console.error(">>> Connection initiated");

// Keep the process alive
setInterval(() => {
  console.error(">>> Still running");
}, 5000);

console.error(">>> Script reached end");
