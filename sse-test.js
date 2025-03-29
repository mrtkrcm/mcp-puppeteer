// SSE transport test
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';

// Create a simple Express server
const app = express();
const port = process.env.PORT || 3001;

// Create a basic MCP server with a simple echo tool
const server = new Server({
  name: "mcp-sse-test",
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
        console.log(`Echo tool called with: ${params.message}`);
        return { message: params.message };
      }
    }
  ]
});

// Set up SSE endpoint
app.get('/sse', async (req, res) => {
  console.log('Client connected to SSE endpoint');
  
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  try {
    // Create a new transport for this connection
    const transport = new SSEServerTransport(req, res);
    
    // Connect the server to this transport
    await server.connect(transport);
    console.log('Server connected to client via SSE');
  } catch (error) {
    console.error('Error connecting server to SSE transport:', error);
    // Only end the response if headers haven't been sent
    if (!res.headersSent) {
      res.status(500).end();
    }
  }
  
  // Handle client disconnect
  req.on('close', () => {
    console.log('Client disconnected from SSE endpoint');
  });
});

// Set up message endpoint for receiving client messages
app.post('/messages', express.json(), async (req, res) => {
  console.log('Received message:', req.body);
  
  try {
    // In a real implementation, you would need to forward this message
    // to the appropriate SSE connection/transport
    
    res.json({ status: 'received' });
  } catch (error) {
    console.error('Error processing message:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add a simple status endpoint
app.get('/', (req, res) => {
  res.send('MCP SSE Test Server is running. Connect to /sse for Server-Sent Events.');
});

// Start Express server
app.listen(port, () => {
  console.log(`Express server listening on port ${port}`);
  console.log(`SSE endpoint available at http://localhost:${port}/sse`);
  console.log(`Messages endpoint available at http://localhost:${port}/messages`);
});

// Keep the process alive
setInterval(() => {
  console.log("Server still running (keep-alive)");
}, 60000); // Log every minute
