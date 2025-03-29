import { spawn } from 'child_process';

class JsonRpcClient {
  constructor(stdin, stdout) {
    this.stdin = stdin;
    this.stdout = stdout;
    this.pendingRequests = new Map();
    this.nextId = 1;

    this.setupMessageHandler();
  }

  setupMessageHandler() {
    let buffer = '';
    this.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim() === '') continue;
        try {
          const message = JSON.parse(line);
          this.handleMessage(message);
        } catch (e) {
          console.error('Failed to parse message:', e);
        }
      }
    });
  }

  handleMessage(message) {
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(message.error.message || 'Unknown error'));
      } else {
        resolve(message.result);
      }
    }
  }

  async request(method, params = {}) {
    const id = (this.nextId++).toString();

    return new Promise((resolve, reject) => {
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });
      this.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  async listTools() {
    return this.request('tools/list');
  }

  async callTool(name, args) {
    return this.request('tools/call', { name, arguments: args });
  }

  async listResources() {
    return this.request('resources/list');
  }

  async readResource(name) {
    return this.request('resources/read', { uri: name });
  }

  close() {
    // Nothing to do
  }
}

async function main() {
  console.log('Starting MCP Puppeteer server example...');

  // Start the server process
  const serverProcess = spawn('node', ['dist/index.js'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Log server output for debugging
  serverProcess.stderr.on('data', (data) => {
    console.log('SERVER:', data.toString().trim());
  });

  // Create JSON-RPC client
  const client = new JsonRpcClient(serverProcess.stdin, serverProcess.stdout);

  try {
    // List available tools
    const tools = await client.listTools();
    console.log('Available tools:');
    for (const tool of tools.tools) {
      console.log(`- ${tool.name}: ${tool.description}`);
    }

    // Navigate to a webpage
    console.log('\nNavigating to example.com...');
    const navigateResponse = await client.callTool('puppeteer_navigate', {
      url: 'https://example.com'
    });
    console.log('Navigation result:', navigateResponse.content[0].text);

    // Take a screenshot
    console.log('\nTaking screenshot...');
    const screenshotResponse = await client.callTool('puppeteer_screenshot', {
      name: 'example-page',
      width: 1024,
      height: 768
    });
    console.log('Screenshot result:', screenshotResponse.content[0].text);

    // Execute JavaScript
    console.log('\nExecuting JavaScript...');
    try {
      const evalResponse = await client.callTool('puppeteer_evaluate', {
        script: 'return document.title'
      });
      console.log('JavaScript result:', evalResponse.content[0].text);
    } catch (e) {
      console.log('JavaScript execution failed:', e.message);

      // Try with a simpler script
      try {
        const simpleEvalResponse = await client.callTool('puppeteer_evaluate', {
          script: 'document.title'
        });
        console.log('Simple JavaScript result:', simpleEvalResponse.content[0].text);
      } catch (e2) {
        console.log('Simple JavaScript execution also failed:', e2.message);
      }
    }

    // Generate accessibility snapshot
    console.log('\nGenerating accessibility snapshot...');
    try {
      const snapshotResponse = await client.callTool('browser_snapshot', {});
      console.log('Snapshot generated - preview:');

      // Show a brief preview of the snapshot
      if (snapshotResponse.content && snapshotResponse.content[0] && snapshotResponse.content[0].text) {
        const snapshot = snapshotResponse.content[0].text;
        const lines = snapshot.split('\n');
        const previewLines = [
          ...lines.slice(0, 3), // URL and title
          '...',
          ...lines.slice(lines.findIndex(l => l.includes('```yaml')) + 1, lines.findIndex(l => l.includes('```yaml')) + 6) // First few elements
        ];
        console.log(previewLines.join('\n'));

        // Count the number of elements with references
        const elementCount = (snapshot.match(/\[ref=/g) || []).length;
        console.log(`Total elements with references: ${elementCount}`);
      } else {
        console.log('Error: Snapshot response format was invalid');
      }
    } catch (e) {
      console.log('Snapshot generation failed:', e.message);
    }

    // List resources
    const resources = await client.listResources();
    console.log('\nAvailable resources:');
    for (const resource of resources.resources) {
      console.log(`- ${resource.name} (${resource.type})`);
    }

    // Read console logs
    try {
      console.log('\nReading console logs...');
      const logsResponse = await client.readResource('console://logs');
      console.log('Console logs:',
        logsResponse && logsResponse.content && logsResponse.content[0] ?
        logsResponse.content[0].text :
        'No logs available');
    } catch (e) {
      console.log('Failed to read console logs:', e.message);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Clean up
    client.close();
    serverProcess.kill();
    console.log('\nServer process terminated');
  }
}

main().catch(console.error);
