import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import puppeteer from 'puppeteer';
import { formatAccessibilityTreeToYaml } from '../src/utils/yamlFormatter.js';
import { generateAccessibilitySnapshot } from '../src/browser/snapshot.js';

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
    browser = await puppeteer.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser?.close();
  });

  test('generates snapshot for simple page', async () => {
    await page.setContent('<button>Test Button</button>');
    const snapshot = await generateAccessibilitySnapshot(page);

    expect(snapshot).toBeDefined();
    expect(snapshot).toContain('role: button');
    expect(snapshot).toContain('name: Test Button');
  });

  test('handles errors gracefully', async () => {
    expect(await generateAccessibilitySnapshot(null))
      .toBe('Error: No page provided');
  });
});
