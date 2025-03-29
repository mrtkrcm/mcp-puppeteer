// Absolute minimal test
console.error(">>> Script starting");

// Import specific modules from the SDK
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

console.error(">>> SDK Server imported successfully");

// Keep the process alive
setInterval(() => {
  console.error(">>> Still running");
}, 5000);

console.error(">>> Script reached end");
