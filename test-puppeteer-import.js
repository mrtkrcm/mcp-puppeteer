import puppeteer from 'puppeteer';

async function run() {
  console.log('>>> Puppeteer import test: START');
  try {
    // Just try to launch - don't need to connect or do anything
    const browser = await puppeteer.launch();
    console.log('>>> Puppeteer import test: LAUNCH SUCCEEDED');
    await browser.close();
    console.log('>>> Puppeteer import test: BROWSER CLOSED');
  } catch (err) {
    console.error('>>> Puppeteer import test: FAILED', err);
  }
  console.log('>>> Puppeteer import test: END');
}

run();
