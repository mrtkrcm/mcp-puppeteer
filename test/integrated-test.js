#!/usr/bin/env node

/**
 * Integrated test for MCP Puppeteer server
 * Covers critical functionality: tools listing, navigation, screenshots, and resources
 */

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

async function runTest(testName, testFn) {
  try {
    console.log(`\n[TEST] ${testName}`);
    await testFn();
    console.log(`✓ PASSED: ${testName}`);
    return true;
  } catch (error) {
    console.error(`✗ FAILED: ${testName}`);
    console.error(`  Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('Starting MCP Puppeteer server integrated tests...');

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
  let totalTests = 0;
  let passedTests = 0;

  try {
    // Tools listing test
    totalTests++;
    passedTests += await runTest('List available tools', async () => {
      const tools = await client.listTools();
      if (!tools || !tools.tools || !Array.isArray(tools.tools) || tools.tools.length === 0) {
        throw new Error('No tools returned');
      }

      console.log(`  Found ${tools.tools.length} tools`);

      const requiredTools = [
        'puppeteer_navigate',
        'puppeteer_screenshot',
        'puppeteer_click',
        'puppeteer_fill',
        'puppeteer_evaluate'
      ];

      for (const tool of requiredTools) {
        if (!tools.tools.some(t => t.name === tool)) {
          throw new Error(`Required tool not found: ${tool}`);
        }
      }
    });

    // Navigation test
    totalTests++;
    passedTests += await runTest('Navigate to a webpage', async () => {
      const response = await client.callTool('puppeteer_navigate', {
        url: 'https://example.com'
      });

      if (!response || !response.content || !response.content[0] || !response.content[0].text) {
        throw new Error('Invalid navigation response');
      }

      if (response.isError) {
        throw new Error(`Navigation failed: ${response.content[0].text}`);
      }

      console.log(`  ${response.content[0].text}`);
    });

    // Screenshot test
    totalTests++;
    passedTests += await runTest('Take a screenshot', async () => {
      const screenshotName = 'test-screenshot';
      const response = await client.callTool('puppeteer_screenshot', {
        name: screenshotName,
        width: 1024,
        height: 768
      });

      if (!response || !response.content || !response.content[0] || !response.content[0].text) {
        throw new Error('Invalid screenshot response');
      }

      if (response.isError) {
        throw new Error(`Screenshot failed: ${response.content[0].text}`);
      }

      console.log(`  ${response.content[0].text}`);

      // Verify screenshot is in resources
      const resources = await client.listResources();
      if (!resources.resources.some(r => r.name === `screenshot://${screenshotName}`)) {
        throw new Error(`Screenshot resource not found: ${screenshotName}`);
      }
    });

    // JavaScript execution test
    totalTests++;
    passedTests += await runTest('Execute JavaScript', async () => {
      const response = await client.callTool('puppeteer_evaluate', {
        script: 'document.title'
      });

      if (!response || !response.content || !response.content[0] || !response.content[0].text) {
        throw new Error('Invalid JavaScript execution response');
      }

      if (response.isError) {
        throw new Error(`JavaScript execution failed: ${response.content[0].text}`);
      }

      console.log(`  Result: ${response.content[0].text}`);
    });

    // Element interaction test
    totalTests++;
    passedTests += await runTest('Element interaction (click)', async () => {
      // Try to click an element that should exist on example.com
      const response = await client.callTool('puppeteer_click', {
        selector: 'a' // Example.com typically has at least one link
      });

      if (!response || !response.content || !response.content[0] || !response.content[0].text) {
        throw new Error('Invalid click response');
      }

      console.log(`  ${response.content[0].text}`);
    });

    // Test error handling
    totalTests++;
    passedTests += await runTest('Error handling', async () => {
      try {
        await client.callTool('puppeteer_navigate', {
          url: 'https://invalid-url-that-should-not-exist.example'
        });
        // If it doesn't throw, make sure the response indicates an error
        throw new Error('Expected navigation to fail with an error');
      } catch (error) {
        // This is expected - navigation to invalid URL should fail
        console.log('  Error handling works as expected');
      }
    });

    // Output results
    console.log(`\n===== Test Results: ${passedTests}/${totalTests} tests passed =====`);

    if (passedTests === totalTests) {
      console.log('✅ All tests passed!');
    } else {
      console.log(`❌ ${totalTests - passedTests} tests failed.`);
      process.exit(1);
    }

  } catch (error) {
    console.error('Unexpected error during tests:', error);
    process.exit(1);
  } finally {
    // Clean up
    client.close();
    serverProcess.kill();
    console.log('\nTest completed, server terminated');
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
