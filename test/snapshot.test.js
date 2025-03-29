import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import puppeteer from 'puppeteer';
import { formatAccessibilityTreeToYaml } from '../src/utils/yamlFormatter.js';
import { generateAccessibilitySnapshot } from '../src/browser/snapshot.js';

// Configure puppeteer for CI environments
const puppeteerConfig = {
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu'
  ]
};

// For CI environments
if (process.env.PUPPETEER_EXECUTABLE_PATH) {
  console.log('Using PUPPETEER_EXECUTABLE_PATH:', process.env.PUPPETEER_EXECUTABLE_PATH);
  puppeteerConfig.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

// Check if there's any incorrect executablePath value
if (puppeteerConfig.executablePath === '$(which chrome)') {
  console.log('Removing incorrect executablePath:', puppeteerConfig.executablePath);
  delete puppeteerConfig.executablePath;
}

console.log('Puppeteer config:', JSON.stringify(puppeteerConfig, null, 2));

describe('YAML Formatter', () => {
  const mockNode = {
    role: 'WebArea',
    name: 'Document',
    children: [
      { role: 'heading', name: 'Main Heading', level: 1 },
      { role: 'link', name: 'Click Me', children: [
        { role: 'StaticText', name: 'Click Me' }
      ]}
    ]
  };

  test('formats accessibility tree correctly', () => {
    const yaml = formatAccessibilityTreeToYaml(mockNode);
    expect(yaml).toContain('role: WebArea');
    expect(yaml).toContain('name: Document');
    expect(yaml).toContain('role: heading');
    expect(yaml).toContain('role: link');
  });

  test('handles edge cases', () => {
    expect(formatAccessibilityTreeToYaml(null)).toBe('');
    expect(formatAccessibilityTreeToYaml(undefined)).toBe('');
    expect(formatAccessibilityTreeToYaml({})).toBe('');
  });

  test('uses custom frame prefix', () => {
    const yaml = formatAccessibilityTreeToYaml(mockNode, 'f0s1');
    expect(yaml).toContain('id: f0s1e1');
  });
});

describe('Accessibility Snapshot Generator', () => {
  let browser;
  let page;

  beforeAll(async () => {
    try {
      browser = await puppeteer.launch(puppeteerConfig);
      page = await browser.newPage();
    } catch (error) {
      console.error('Error launching Puppeteer:', error);
      throw error;
    }
  });

  afterAll(async () => {
    await browser?.close();
  });

  test('generates snapshot for simple page', async () => {
    try {
      await page.setContent('<button>Test Button</button>');
      const snapshot = await generateAccessibilitySnapshot(page);

      expect(snapshot).toBeDefined();
      expect(snapshot).toContain('role: button');
      expect(snapshot).toContain('name: Test Button');
    } catch (error) {
      console.error('Error generating snapshot:', error);
      throw error;
    }
  });

  test('handles errors gracefully', async () => {
    expect(await generateAccessibilitySnapshot(null))
      .toBe('Error: No page provided');
  });
});
