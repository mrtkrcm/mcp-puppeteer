# MCP Puppeteer

A Model Context Protocol server that provides browser automation capabilities using Puppeteer. This server enables LLMs to interact with web pages, take screenshots, and execute JavaScript in a real browser environment.

## Features

- 🌐 Browser automation with Puppeteer
- 📸 Screenshot capabilities
- 🔍 Accessibility tree generation
- 🎯 Element targeting with frame support
- 🖱️ User interaction simulation (click, hover, type)
- 📝 Form manipulation
- 🚀 JavaScript execution
- 📊 Console log monitoring

## Structure

- `/src` - TypeScript source files
- `/dist` - Compiled JavaScript
- `/examples` - Example implementations

## Getting Started


## SSE Client

Monitor your MCP Puppeteer server in real-time:

```html
<!-- In HTML file -->
<script type="module" src="../dist/client.js"></script>
```

Features:
- Event-based architecture
- Automatic reconnection
- Strongly typed events
- Responsive UI

## Testing

```bash
# Run client tests
npm test

# Run with coverage
npm run test:coverage
```

## Contributing

1. Fork the repository
2. Create your feature branch
3. Add tests for new features
4. Ensure all tests pass
5. Submit a pull request

## Development

The TypeScript configuration prioritizes:
- Type safety
- ES modules
- Jest compatibility
- DOM access for client components

## License

MIT

