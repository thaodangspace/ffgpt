import { describe, expect, it } from 'vitest';
import { FirefoxBiDiDriver } from '../../src/browser/index.js';

const enabled = process.env.FFGPT_RUN_FIREFOX_INTEGRATION === '1';
const host = process.env.FFGPT_HOST ?? '127.0.0.1';
const port = Number(process.env.FFGPT_PORT ?? '9222');
const timeoutMs = Number(process.env.FFGPT_TIMEOUT_MS ?? '5000');

describe('local Firefox WebDriver BiDi integration', () => {
  it.skipIf(!enabled)('connects, enumerates contexts, and disconnects safely', async () => {
    const driver = new FirefoxBiDiDriver({ host, port, timeoutMs });
    await driver.connect();
    const contexts = await driver.listContexts();
    await driver.disconnect();

    expect(contexts).toEqual(expect.any(Array));
  });
});
