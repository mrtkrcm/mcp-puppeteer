# Puppeteer

A Model Context Protocol server that provides browser automation capabilities using Puppeteer. This server enables LLMs to interact with web pages, take screenshots, and execute JavaScript in a real browser environment.

## Components

### Tools

- **puppeteer_navigate**
  - Navigate to any URL in the browser
  - Input: `url` (string)

- **puppeteer_screenshot**
  - Capture screenshots of the entire page or specific elements
  - Inputs:
    - `name` (string, required): Name for the screenshot
    - `selector` (string, optional): CSS selector for element to screenshot
    - `width` (number, optional, default: 800): Screenshot width
    - `height` (number, optional, default: 600): Screenshot height

- **puppeteer_click**
  - Click elements on the page
  - Input: `selector` (string): CSS selector for element to click

- **puppeteer_hover**
  - Hover elements on the page
  - Input: `selector` (string): CSS selector for element to hover

- **puppeteer_fill**
  - Fill out input fields
  - Inputs:
    - `selector` (string): CSS selector for input field
    - `value` (string): Value to fill

- **puppeteer_select**
  - Select an element with SELECT tag
  - Inputs:
    - `selector` (string): CSS selector for element to select
    - `value` (string): Value to select

- **puppeteer_evaluate**
  - Execute JavaScript in the browser console
  - Input: `script` (string): JavaScript code to execute

### Resources

The server provides access to two types of resources:

1. **Console Logs** (`console://logs`)
   - Browser console output in text format
   - Includes all console messages from the browser

2. **Screenshots** (`screenshot://<name>`)
   - PNG images of captured screenshots
   - Accessible via the screenshot name specified during capture

## Key Features

- Browser automation
- Console log monitoring
- Screenshot capabilities
- JavaScript execution
- Basic web interaction (navigation, clicking, form filling)

## Remote Chrome Integration

This server can connect to any remote Chrome instance using the Chrome DevTools Protocol instead of launching a new Chrome instance for each session. This flexibility provides several benefits:

- Reduced resource usage
- Better stability
- Shared browser instance
- Custom browser configurations

### Remote Chrome Options

You can use any of these options for remote Chrome:

#### 1. Browserless

[Browserless](https://docs.browserless.io/) provides a fully managed Chrome instance:

```bash
docker run -p 3000:3000 ghcr.io/browserless/chromium
```

#### 2. Chrome with Remote Debugging

Start Chrome with remote debugging enabled:

```bash
chrome --remote-debugging-port=3000 --remote-debugging-address=0.0.0.0
```

#### 3. Custom Chrome Debug Protocol Proxy

Any other proxy that implements the Chrome Debug Protocol WebSocket interface.

### Running with Remote Chrome

Connect the server to a remote Chrome instance:

```bash
# Using the PUPPETEER_BROWSER_WS_ENDPOINT environment variable
PUPPETEER_BROWSER_WS_ENDPOINT=ws://localhost:3000 node dist/index.js

# Or using the convenience script (which sets the PUPPETEER_BROWSER_WS_ENDPOINT var)
npm run start:remote
```

The server will automatically connect to the remote Chrome instance. If the connection fails, it will fall back to launching a local Chrome instance unless `FALLBACK_TO_LOCAL_CHROME=false` is set.

## Configuration to use Puppeteer Server

Here's the Claude Desktop configuration to use the Puppeteer server:

### Docker

**NOTE** The docker implementation will use headless chromium, where as the NPX version will open a browser window.

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--init", "-e", "DOCKER_CONTAINER=true", "mcp/puppeteer"]
    }
  }
}
```

### NPX

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-puppeteer"]
    }
  }
}
```

### With Remote Chrome

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "npm",
      "args": ["run", "start:remote"],
      "cwd": "/path/to/mcp-puppeteer",
      "env": {
        "PUPPETEER_BROWSER_WS_ENDPOINT": "ws://chrome-server:3000"
      }
    }
  }
}
```

## Environment Variables

The server can be configured using the following environment variables:

- `PUPPETEER_BROWSER_WS_ENDPOINT`: WebSocket URL to the Chrome instance (e.g., `ws://localhost:3000`)
- `PUPPETEER_CONNECT_OPTIONS_JSON`: JSON string with Puppeteer connect options
- `PUPPETEER_SLOW_MO`: Delay between Puppeteer operations in ms
- `PUPPETEER_DEFAULT_VIEWPORT_JSON`: JSON string with viewport configuration
- `PUPPETEER_PROTOCOL_TIMEOUT`: Timeout for Chrome DevTools Protocol in ms
- `FALLBACK_TO_LOCAL_CHROME`: Set to `false` to disable fallback to local Chrome
- `DOCKER_CONTAINER`: Set to `true` when running in Docker to adjust Chrome launch options

## Build

Docker build:

```bash
docker build -t mcp/puppeteer -f Dockerfile .
```

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.

## Testing

This project includes an integrated test suite that validates all critical functionality:

```bash
# Run the integrated tests
npm test

# Run the example
npm run test:example
```

The tests verify:
- Tool availability and listing
- Navigation functionality
- Screenshot capture
- JavaScript execution
- Element interaction
- Error handling

### Contributing Tests

When adding new features, please also add corresponding test cases to the integrated test suite. All pull requests should include tests for new functionality or bug fixes.

### Direct JSON-RPC Communication

You can communicate with the server directly using JSON-RPC without the MCP SDK. This approach works with all versions of the server:

```javascript
import { spawn } from 'child_process';

class JsonRpcClient {
  constructor(stdin, stdout) {
    this.stdin = stdin;
    this.stdout = stdout;
    this.pendingRequests = new Map();
    this.nextId = 1;

    // Set up message handling
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

  // Helper methods
  async listTools() {
    return this.request('tools/list');
  }

  async callTool(name, args) {
    return this.request('tools/call', { name, arguments: args });
  }
}
```

### JSON-RPC Methods

The server supports the following JSON-RPC methods:

- `tools/list`: List available tools
- `tools/call`: Call a tool with arguments
- `resources/list`: List available resources
- `resources/read`: Read a resource by name (with parameter `uri`)
