import '@testing-library/jest-dom';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { SSEClient } from './client';

// Mock EventSource as it's not available in jsdom
class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  url: string;
  readyState: number;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    this.readyState = MockEventSource.CONNECTING;
  }

  close(): void { }
  addEventListener(type: string, listener: EventListener): void { }
  removeEventListener(type: string, listener: EventListener): void { }
}

// Define EventSource globally if it doesn't exist
if (!global.EventSource) {
  global.EventSource = MockEventSource as any;
}

describe('SSEClient', () => {
  let mockEventSource: any;

  beforeEach(() => {
    // Mock DOM elements
    document.body.innerHTML = `
            <div id="events" class="events-container"></div>
            <button id="connectBtn">Connect</button>
            <button id="disconnectBtn" disabled>Disconnect</button>
            <button id="clearBtn">Clear Events</button>
            <input id="serverUrl" value="http://localhost:3001">
            <div id="connectionStatus" class="connection-status disconnected">Disconnected</div>
            <div id="serverStatusInfo">Not connected</div>
            <div id="browserStatusInfo">Not connected</div>
        `;

    // Mock EventSource
    mockEventSource = {
      close: jest.fn(),
      addEventListener: jest.fn(),
      onopen: null,
      onerror: null,
      onmessage: null,
      readyState: EventSource.CONNECTING
    };

    // @ts-ignore
    global.EventSource = jest.fn().mockImplementation((url) => {
      mockEventSource.url = url;
      // Simulate connection success after a small delay
      setTimeout(() => {
        if (mockEventSource.onopen) {
          mockEventSource.onopen(new Event('open'));
        }
      }, 10);
      return mockEventSource;
    });
  });

  afterEach(() => {
    // Restore original EventSource
    global.EventSource = MockEventSource as any;
    jest.clearAllMocks();
  });

  test('initializes with correct elements', async () => {
    const { SSEClient } = await import('./client');
    const client = new SSEClient();

    expect(document.getElementById('events')).toBeInTheDocument();
    expect(document.getElementById('connectBtn')).toBeInTheDocument();
    expect(document.getElementById('disconnectBtn')).toBeInTheDocument();
    expect(document.getElementById('clearBtn')).toBeInTheDocument();
    expect(document.getElementById('serverUrl')).toBeInTheDocument();
    expect(document.getElementById('connectionStatus')).toBeInTheDocument();
    expect(document.getElementById('serverStatusInfo')).toBeInTheDocument();
    expect(document.getElementById('browserStatusInfo')).toBeInTheDocument();
  });

  test('connects to SSE server on connect button click', async () => {
    const { SSEClient } = await import('./client');
    const client = new SSEClient();
    const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;

    connectBtn.click();

    expect(EventSource).toHaveBeenCalledWith('http://localhost:3001/events');
  });

  test('disconnects from SSE server on disconnect button click', async () => {
    const { SSEClient } = await import('./client');
    const client = new SSEClient();
    const disconnectBtn = document.getElementById('disconnectBtn') as HTMLButtonElement;
    const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;

    // First connect
    connectBtn.click();

    // Wait for onopen to be called (simulates connection established)
    await new Promise(resolve => setTimeout(resolve, 20));

    // Then disconnect
    disconnectBtn.click();

    expect(mockEventSource.close).toHaveBeenCalled();
    expect(document.getElementById('connectionStatus')?.className).toContain('disconnected');
  });

  test('clears events on clear button click', async () => {
    const { SSEClient } = await import('./client');
    const client = new SSEClient();
    const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
    const eventsContainer = document.getElementById('events') as HTMLDivElement;

    // Add some test events
    eventsContainer.innerHTML = '<div>Test Event 1</div><div>Test Event 2</div>';

    clearBtn.click();

    expect(eventsContainer.innerHTML).toBe('');
  });

  test('handles server status events correctly', async () => {
    const { SSEClient } = await import('./client');
    const client = new SSEClient();
    const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;

    // Connect first
    connectBtn.click();

    // Wait for connection to establish
    await new Promise(resolve => setTimeout(resolve, 20));

    // Simulate server status event
    const mockServerEvent = new MessageEvent('server_status', {
      data: JSON.stringify({
        status: 'running',
        port: 3001
      })
    });

    // Find and call the event listener for server_status
    const serverStatusCalls = mockEventSource.addEventListener.mock.calls.filter(
      ([name]: string[]) => name === 'server_status'
    );

    if (serverStatusCalls.length > 0) {
      const [, eventListener] = serverStatusCalls[0];
      eventListener(mockServerEvent);
    }

    const serverStatusInfo = document.getElementById('serverStatusInfo') as HTMLDivElement;
    expect(serverStatusInfo.textContent).toContain('running');
    expect(serverStatusInfo.textContent).toContain('3001');
  });

  test('handles browser status events correctly', async () => {
    const { SSEClient } = await import('./client');
    const client = new SSEClient();
    const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;

    // Connect first
    connectBtn.click();

    // Wait for connection to establish
    await new Promise(resolve => setTimeout(resolve, 20));

    // Simulate browser status event
    const mockBrowserEvent = new MessageEvent('browser_status', {
      data: JSON.stringify({
        status: 'connected'
      })
    });

    // Find and call the event listener for browser_status
    const browserStatusCalls = mockEventSource.addEventListener.mock.calls.filter(
      ([name]: string[]) => name === 'browser_status'
    );

    if (browserStatusCalls.length > 0) {
      const [, eventListener] = browserStatusCalls[0];
      eventListener(mockBrowserEvent);
    }

    const browserStatusInfo = document.getElementById('browserStatusInfo') as HTMLDivElement;
    expect(browserStatusInfo.textContent).toContain('connected');
  });
});
