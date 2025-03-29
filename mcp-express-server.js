// Combined MCP and Express server
console.error(">>> Script starting");

// Import SDK modules
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from 'express';

console.error(">>> Imports successful");

// Create Express app
const app = express();
const port = process.env.PORT || 3003;

// Create a server instance with a simple echo tool
const server = new Server({
  name: "mcp-puppeteer",
  version: "0.1.0",
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

// Set up SSE endpoint
app.get('/sse', async (req, res) => {
  console.error('>>> Client connected to SSE endpoint');
  
  try {
    // Create a new transport for this connection
    const transport = new SSEServerTransport(req, res);
    
    // Connect the server to this transport
    await server.connect(transport);
    console.error('>>> Server connected to client via SSE');
  } catch (error) {
    console.error('>>> Error connecting server to SSE transport:', error);
    // Only end the response if headers haven't been sent
    if (!res.headersSent) {
      res.status(500).end();
    }
  }
  
  // Handle client disconnect
  req.on('close', () => {
    console.error('>>> Client disconnected from SSE endpoint');
  });
});

// Set up message endpoint for receiving client messages
app.post('/messages', express.json(), async (req, res) => {
  console.error('>>> Received message:', req.body);
  
  try {
    // In a real implementation, you would need to forward this message
    // to the appropriate SSE connection/transport
    
    res.json({ status: 'received' });
  } catch (error) {
    console.error('>>> Error processing message:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add a simple status endpoint
app.get('/', (req, res) => {
  res.send('MCP Puppeteer Server is running. Connect to /sse for Server-Sent Events.');
});

// Start Express server
app.listen(port, () => {
  console.error(`>>> Express server listening on port ${port}`);
  console.error(`>>> SSE endpoint available at http://localhost:${port}/sse`);
  console.error(`>>> Messages endpoint available at http://localhost:${port}/messages`);
});

console.error(">>> Script reached end");

// Keep the process alive for debugging
setInterval(() => {
  console.error(">>> Server still running (keep-alive)");
}, 10000); // Log every 10 seconds
