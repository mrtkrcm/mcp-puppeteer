#!/usr/bin/env node

/**
 * Test for accessibility snapshot functionality
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
  console.log('Starting accessibility snapshot tests...');

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
    // Verify the browser_snapshot tool is available
    totalTests++;
    passedTests += await runTest('Verify browser_snapshot tool is available', async () => {
      const response = await client.listTools();
      if (!response.tools.some(tool => tool.name === 'browser_snapshot')) {
        throw new Error('browser_snapshot tool not found');
      }
      console.log('  Found browser_snapshot tool');
    });

    // Navigate to a test page
    console.log('\nNavigating to example.com for tests...');
    await client.callTool('puppeteer_navigate', {
      url: 'https://example.com'
    });

    // Test accessibility snapshot generation
    totalTests++;
    passedTests += await runTest('Generate accessibility snapshot', async () => {
      const response = await client.callTool('browser_snapshot', {});

      if (!response || !response.content || !response.content[0] || !response.content[0].text) {
        throw new Error('Invalid snapshot response');
      }

      if (response.isError) {
        throw new Error(`Snapshot generation failed: ${response.content[0].text}`);
      }

      const snapshot = response.content[0].text;

      // Check for required elements in the snapshot
      if (!snapshot.includes('Page URL:')) {
        throw new Error('Snapshot missing Page URL');
      }

      if (!snapshot.includes('Page Title:')) {
        throw new Error('Snapshot missing Page Title');
      }

      if (!snapshot.includes('Page Snapshot')) {
        throw new Error('Snapshot missing Page Snapshot section');
      }

      if (!snapshot.includes('```yaml')) {
        throw new Error('Snapshot missing YAML code block');
      }

      if (!snapshot.includes('[ref=')) {
        throw new Error('Snapshot missing element references');
      }

      console.log('  Generated accessibility snapshot successfully');
      // Print a summary of the snapshot
      const lines = snapshot.split('\n');
      console.log(`  URL: ${lines.find(line => line.startsWith('- Page URL:'))?.replace('- Page URL:', '').trim()}`);
      console.log(`  Title: ${lines.find(line => line.startsWith('- Page Title:'))?.replace('- Page Title:', '').trim()}`);

      // Count elements in the snapshot
      const elementCount = (snapshot.match(/\[ref=/g) || []).length;
      console.log(`  Snapshot contains ${elementCount} elements with references`);
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
    client.close();
    serverProcess.kill();
    console.log('\nServer process terminated');
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
