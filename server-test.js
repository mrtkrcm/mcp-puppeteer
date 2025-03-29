// Server instance test
console.error(">>> Script starting");

// Import specific modules from the SDK
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

console.error(">>> SDK Server imported successfully");

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

// Keep the process alive
setInterval(() => {
  console.error(">>> Still running");
}, 5000);

console.error(">>> Script reached end");
