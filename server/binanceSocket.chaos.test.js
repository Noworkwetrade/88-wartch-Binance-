import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BinanceSocketManager } from './binanceSocket.js';
import { marketCache } from './marketCache.js';

class MockWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 1; // OPEN
  }
  terminate() {
    this.readyState = 3;
    this.emit('close', 1006, 'terminated');
  }
  close(code = 1000, reason = 'closed') {
    this.readyState = 3;
    this.emit('close', code, reason);
  }
  pong() {}
}

test('Task 5 — Binance WebSocket Failure Modes & Chaos Tests', async (t) => {
  await t.test('1. Silent connection: watchdog fires and reconnects; prices resume flowing', async () => {
    let socketInstance = null;
    let connectCount = 0;

    const manager = new BinanceSocketManager({
      watchdogCheckMs: 20,
      watchdogTimeoutMs: 50,
      reconnectBaseDelayMs: 20,
      reconnectMaxDelayMs: 50,
      createSocket: (url) => {
        connectCount++;
        socketInstance = new MockWebSocket(url);
        return socketInstance;
      }
    });

    try {
      manager.connect();
      manager.handleOpen();
      assert.equal(manager.status, 'connected');
      assert.equal(connectCount, 1);

      // Start watchdog and simulate silent connection (>50ms silence)
      manager.startWatchdog();
      manager._simulateSilence();

      // Wait for watchdog to trigger reconnect
      await new Promise((resolve) => setTimeout(resolve, 80));

      assert.ok(
        connectCount >= 2,
        `Expected watchdog to trigger reconnect (connectCount=${connectCount})`
      );

      // Verify prices resume flowing after reconnect
      let receivedTicker = null;
      manager.onTickerUpdate((ticker) => {
        receivedTicker = ticker;
      });

      manager._simulateMessage([
        {
          e: '24hrTicker',
          s: 'BTCUSDT',
          c: '64500.00',
          h: '65000.00',
          l: '64000.00',
          v: '120.5',
          E: Date.now()
        }
      ]);

      assert.ok(receivedTicker !== null, 'Prices must resume flowing after reconnect');
      assert.equal(receivedTicker.symbol, 'BTCUSDT');
      assert.equal(receivedTicker.lastPrice, '64500.00');
    } finally {
      manager.destroy();
    }
  });

  await t.test('2. Dropped connection: manager reconnects with backoff', async () => {
    let connectCount = 0;
    const delays = [];
    const startTime = Date.now();

    const manager = new BinanceSocketManager({
      reconnectBaseDelayMs: 20,
      reconnectMaxDelayMs: 200,
      createSocket: (url) => {
        connectCount++;
        delays.push(Date.now() - startTime);
        return new MockWebSocket(url);
      }
    });

    try {
      manager.connect();
      manager.handleOpen();
      assert.equal(manager.status, 'connected');

      // Abrupt drop
      manager._simulateDrop(1006, 'Abrupt network drop');
      assert.equal(manager.status, 'reconnecting');
      assert.equal(manager.reconnectAttempts, 1);

      // Wait for first backoff reconnect
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(connectCount, 2, 'First reconnect should have fired after backoff');

      // Second drop to test exponential increment
      manager._simulateDrop(1006, 'Second drop');
      assert.equal(manager.reconnectAttempts, 2);

      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal(connectCount, 3, 'Second reconnect should have fired with exponential backoff');
    } finally {
      manager.destroy();
    }
  });

  await t.test('3. Endpoint failover: first endpoint fails, second is used', async () => {
    const attemptedUrls = [];

    const manager = new BinanceSocketManager({
      urls: [
        'wss://endpoint-1.binance.mock/ws',
        'wss://endpoint-2.binance.mock/ws',
        'wss://endpoint-3.binance.mock/ws'
      ],
      reconnectBaseDelayMs: 15,
      createSocket: (url) => {
        attemptedUrls.push(url);
        return new MockWebSocket(url);
      }
    });

    try {
      manager.connect();
      assert.equal(attemptedUrls[0], 'wss://endpoint-1.binance.mock/ws');

      // Endpoint 1 fails / drops
      manager._simulateDrop(1006, 'Endpoint 1 down');

      // Wait for reconnect to second endpoint
      await new Promise((resolve) => setTimeout(resolve, 35));

      assert.ok(attemptedUrls.length >= 2, 'Should failover to second endpoint');
      assert.equal(attemptedUrls[1], 'wss://endpoint-2.binance.mock/ws');
    } finally {
      manager.destroy();
    }
  });

  await t.test('4. Rotation: forced rotation preserves last known valid prices (no gap, no nulls)', async () => {
    const manager = new BinanceSocketManager({
      createSocket: (url) => new MockWebSocket(url)
    });

    try {
      manager.connect();
      manager.handleOpen();

      // Populate a valid price for BTCUSDT into marketCache
      manager._simulateMessage([
        {
          s: 'BTCUSDT',
          c: '64800.50',
          h: '65200.00',
          l: '64100.00',
          v: '250',
          E: Date.now()
        }
      ]);

      const initialTicker = marketCache.getTicker('BTCUSDT');
      assert.ok(initialTicker !== null);
      assert.equal(initialTicker.lastPrice, '64800.50');

      let emittedNullOrInvalid = false;
      manager.onTickerUpdate((ticker) => {
        if (!ticker || ticker.lastPrice === null || ticker.lastPrice === undefined || ticker.lastPrice === '--') {
          emittedNullOrInvalid = true;
        }
      });

      // Force connection rotation path
      manager._simulateRotation();

      // Assert price in cache is preserved and no null prices emitted
      const preservedTicker = marketCache.getTicker('BTCUSDT');
      assert.equal(preservedTicker.lastPrice, '64800.50', 'Price must be preserved across rotation');
      assert.equal(emittedNullOrInvalid, false, 'No null or invalid prices emitted during rotation');
    } finally {
      manager.destroy();
    }
  });

  await t.test('5. Simultaneous failure: watchdog fires AND socket drops in the same window (no double-reconnect, no leak)', async () => {
    let connectCount = 0;
    let activeSocket = null;

    const mgr = new BinanceSocketManager({
      watchdogCheckMs: 20,
      watchdogTimeoutMs: 40,
      reconnectBaseDelayMs: 40,
      createSocket: (url) => {
        connectCount++;
        activeSocket = new MockWebSocket(url);
        return activeSocket;
      }
    });

    try {
      mgr.connect();
      mgr.handleOpen();
      assert.equal(connectCount, 1);

      mgr.startWatchdog();

      mgr.on('price', () => {});
      const before = mgr.listenerCount('price');
      // trigger simultaneous watchdog + socket drop
      mgr._simulateSilence();
      mgr._simulateDrop(1006, 'Simultaneous drop with watchdog timeout');

      // Give enough time for one backoff period
      await new Promise((resolve) => setTimeout(resolve, 80));

      const after = mgr.listenerCount('price');
      assert.equal(after, before, 'listener leak on simultaneous failure');

      // Must have reconnected exactly once, not twice (no race condition / double-reconnect)
      assert.equal(connectCount, 2, 'Simultaneous failures must not trigger double reconnect');

      // Ensure old socket listeners are cleaned up and no listener leak warning
      assert.equal(activeSocket.listenerCount('close'), 1);
    } finally {
      mgr.destroy();
    }
  });
});
