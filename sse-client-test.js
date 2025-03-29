// Simple SSE client test
import fetch from 'node-fetch';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const SERVER_URL = 'http://localhost:3001';

async function testSSEConnection() {
  console.log('Testing SSE connection to', SERVER_URL);
  
  try {
    // Create client
    const client = new Client({
      name: "test-client",
      version: "1.0.0"
    });
    
    // Create transport with explicit endpoint
    const transport = new SSEClientTransport(
      new URL(`${SERVER_URL}/sse`),
      `${SERVER_URL}/messages`
    );
    
    // Connect client to transport
    console.log('Connecting to server...');
    await client.connect(transport);
    console.log('Connected to server');
    
    // Call the echo tool
    console.log('Calling echo tool...');
    const result = await client.callTool('test/echo', {
      message: 'Hello from SSE client test'
    });
    
    console.log('Echo tool result:', result);
    
    // Disconnect after some time
    setTimeout(async () => {
      console.log('Disconnecting from server...');
      await client.disconnect();
      console.log('Disconnected from server');
      process.exit(0);
    }, 2000);
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testSSEConnection();
