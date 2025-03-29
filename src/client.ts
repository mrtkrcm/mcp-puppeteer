interface EventData {
    status?: string;
    port?: number;
    version?: string;
    message?: string;
    type?: string;
}

export class SSEClient {
    private eventSource: EventSource | null = null;
    private readonly maxReconnectAttempts = 5;
    private readonly reconnectDelay = 2000;
    private reconnectAttempts = 0;

    private readonly elements = {
        eventsContainer: document.getElementById('events') as HTMLDivElement,
        connectBtn: document.getElementById('connectBtn') as HTMLButtonElement,
        disconnectBtn: document.getElementById('disconnectBtn') as HTMLButtonElement,
        clearBtn: document.getElementById('clearBtn') as HTMLButtonElement,
        serverUrl: document.getElementById('serverUrl') as HTMLInputElement,
        connectionStatus: document.getElementById('connectionStatus') as HTMLDivElement,
        serverStatusInfo: document.getElementById('serverStatusInfo') as HTMLDivElement,
        browserStatusInfo: document.getElementById('browserStatusInfo') as HTMLDivElement
    };

    constructor() {
        this.initializeEventListeners();
    }

    private initializeEventListeners(): void {
        this.elements.connectBtn.addEventListener('click', () => this.connectToSSE());
        this.elements.disconnectBtn.addEventListener('click', () => this.disconnect());
        this.elements.clearBtn.addEventListener('click', () => this.clearEvents());
    }

    private addEventEntry(type: string, name: string, data?: EventData): void {
        const entry = document.createElement('div');
        entry.className = `event-entry event-${type}`;

        const time = document.createElement('div');
        time.className = 'event-time';
        time.textContent = new Date().toLocaleTimeString();

        const eventName = document.createElement('div');
        eventName.className = 'event-name';
        eventName.textContent = name;

        entry.appendChild(time);
        entry.appendChild(eventName);

        if (data) {
            const eventData = document.createElement('div');
            eventData.className = 'event-data';
            eventData.textContent = JSON.stringify(data, null, 2);
            entry.appendChild(eventData);
        }

        this.elements.eventsContainer.appendChild(entry);
        this.elements.eventsContainer.scrollTop = this.elements.eventsContainer.scrollHeight;
    }

    private updateStatus(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info'): void {
        this.elements.connectionStatus.textContent = message;
        this.elements.connectionStatus.className = `connection-status ${type === 'success' ? 'connected' : 'disconnected'}`;
        this.addEventEntry('Status', 'Status Update', { message, type });
    }

    private connectToSSE(): void {
        if (this.eventSource) {
            this.eventSource.close();
        }

        const url = this.elements.serverUrl.value;
        this.eventSource = new EventSource(`${url}/events`);

        this.eventSource.onopen = () => {
            this.reconnectAttempts = 0;
            this.updateStatus('Connected to event stream', 'success');
            this.elements.disconnectBtn.disabled = false;
            this.elements.connectBtn.disabled = true;
        };

        this.eventSource.onerror = () => {
            if (this.eventSource?.readyState === EventSource.CLOSED) {
                this.updateStatus('Connection closed', 'error');
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    this.updateStatus(`Reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`, 'warning');
                    setTimeout(() => this.connectToSSE(), this.reconnectDelay);
                } else {
                    this.updateStatus('Max reconnection attempts reached. Please reconnect manually.', 'error');
                }
            } else {
                this.updateStatus('Connection error', 'error');
            }
        };

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        if (!this.eventSource) return;

        this.eventSource.onmessage = (event: MessageEvent) => {
            const data = JSON.parse(event.data);
            this.addEventEntry('message', 'Generic message', data);
        };

        const eventTypes = [
            'server_status',
            'browser_status',
            'browser_info',
            'connection_info',
            'page_action',
            'page_error',
            'snapshot_request',
            'snapshot_generated',
            'snapshot_error'
        ];

        eventTypes.forEach(type => {
            this.eventSource?.addEventListener(type, (event: MessageEvent) => {
                const data = JSON.parse(event.data);
                this.handleEvent(type, data);
            });
        });
    }

    private handleEvent(type: string, data: EventData): void {
        switch (type) {
            case 'server_status':
                this.addEventEntry(type, 'Server Status Update', data);
                this.elements.serverStatusInfo.textContent = `${data.status || 'unknown'}${data.port ? ` on port ${data.port}` : ''}`;
                break;
            case 'browser_status':
                this.addEventEntry(type, 'Browser Status Update', data);
                this.elements.browserStatusInfo.textContent = `${data.status || 'unknown'}`;
                break;
            case 'browser_info':
                this.addEventEntry(type, 'Browser Info', data);
                if (data.version) {
                    this.elements.browserStatusInfo.textContent += ` (${data.version})`;
                }
                break;
            default:
                const eventTitles: Record<string, string> = {
                    connection_info: 'Connection Info',
                    page_action: 'Page Action',
                    page_error: 'Page Error',
                    snapshot_request: 'Snapshot Requested',
                    snapshot_generated: 'Snapshot Generated',
                    snapshot_error: 'Snapshot Error'
                };
                this.addEventEntry(type, eventTitles[type] || type, data);
        }
    }

    private disconnect(): void {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
            this.updateStatus('Disconnected', 'error');
            this.elements.disconnectBtn.disabled = true;
            this.elements.connectBtn.disabled = false;
            this.addEventEntry('client', 'Disconnected from event stream');
        }
    }

    private clearEvents(): void {
        this.elements.eventsContainer.innerHTML = '';
    }
}

// Initialize the client when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new SSEClient();
});
