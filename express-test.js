// Simple Express server test
console.error(">>> Script starting");

import express from 'express';

console.error(">>> Express imported");

// Create Express app
const app = express();
const port = process.env.PORT || 3002;

// Set up a simple endpoint
app.get('/', (req, res) => {
  console.error('>>> Client connected to root endpoint');
  res.send('Hello World!');
});

// Start Express server
app.listen(port, () => {
  console.error(`>>> Express server listening on port ${port}`);
});

console.error(">>> Script reached end");
