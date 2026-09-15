import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  BrowserConnectionError,
  FirefoxBiDiDriver,
  type WebSocketConstructor,
} from '../src/browser/index.js';

class FakeWebSocket extends EventEmitter {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readonly url: string;
  readonly sent: string[] = [];
  readyState = 0;

  constructor(url: string) {
    super();
    this.url = url;
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit('open');
    });
  }

  send(serialized: string): void {
    this.sent.push(serialized);
    const message = JSON.parse(serialized) as { id: number; method: string };
    if (message.method === 'session.new' || message.method === 'session.end') {
      queueMicrotask(() =>
        this.emit('message', JSON.stringify({ id: message.id, type: 'success', result: {} })),
      );
    }
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    queueMicrotask(() => this.emit('close'));
  }

  terminate(): void {
    this.close();
  }
}

describe('FirefoxBiDiDriver lifecycle', () => {
  it('connects using session.new and disconnects without browser-close commands', async () => {
    const sockets: FakeWebSocket[] = [];
    const webSocketConstructor = class extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    } as unknown as WebSocketConstructor;
    const driver = new FirefoxBiDiDriver({ webSocketConstructor });

    await driver.connect();
    await driver.disconnect();

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toBe('ws://127.0.0.1:9222/session');
    const methods = sockets[0]?.sent.map((message) => JSON.parse(message).method);
    expect(methods).toEqual(['session.new', 'session.end']);
  });

  it('rejects operations after disconnect', async () => {
    const driver = new FirefoxBiDiDriver({
      webSocketConstructor: FakeWebSocket as unknown as WebSocketConstructor,
    });
    await driver.connect();
    await driver.disconnect();

    await expect(driver.listContexts()).rejects.toBeInstanceOf(BrowserConnectionError);
  });
});
