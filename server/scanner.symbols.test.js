import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symbolManager, allDataSymbols, scannerSymbols } from './symbolManager.js';

test('Task 2 — USDT-only boundary and symbol exposure tests', async (t) => {
  // Test with a controlled universe containing USDT, USDC, USD, and permanently excluded pairs
  const originalSymbols = symbolManager.symbolNames;

  try {
    symbolManager.symbolNames = [
      'BTCUSDT',
      'ETHUSDT',
      'SOLUSDT',
      'BTCUSDC',
      'ETHUSDC',
      'BTCUSD',
      'USDCUSDT', // permanently excluded
      'USD1USDT', // permanently excluded
      'BNBUSDT'
    ];

    await t.test('scannerSymbols() returns zero non-USDT symbols', () => {
      const symbols = scannerSymbols();
      assert.ok(symbols.length > 0, 'scannerSymbols should return symbols');
      for (const s of symbols) {
        assert.ok(s.endsWith('USDT'), `Expected ${s} to end with USDT`);
        assert.ok(!s.endsWith('USDC'), `Expected ${s} not to end with USDC`);
        assert.ok(!s.endsWith('USD') || s.endsWith('USDT'), `Expected ${s} not to be plain USD`);
      }
      const nonUsdt = symbols.filter((s) => !s.endsWith('USDT'));
      assert.equal(nonUsdt.length, 0, 'scannerSymbols() must return zero non-USDT symbols');
    });

    await t.test('USDCUSDT and USD1USDT are excluded from BOTH functions', () => {
      const scannerList = scannerSymbols();
      const allDataList = allDataSymbols();

      assert.ok(!scannerList.includes('USDCUSDT'), 'USDCUSDT must be excluded from scannerSymbols');
      assert.ok(!scannerList.includes('USD1USDT'), 'USD1USDT must be excluded from scannerSymbols');
      assert.ok(!allDataList.includes('USDCUSDT'), 'USDCUSDT must be excluded from allDataSymbols');
      assert.ok(!allDataList.includes('USD1USDT'), 'USD1USDT must be excluded from allDataSymbols');
    });

    await t.test('allDataSymbols() is a superset of scannerSymbols()', () => {
      const scannerList = scannerSymbols();
      const allDataList = allDataSymbols();

      // Every symbol in scannerSymbols must exist in allDataSymbols
      for (const s of scannerList) {
        assert.ok(allDataList.includes(s), `allDataSymbols must contain ${s}`);
      }

      // allDataSymbols must be able to contain non-USDT data pairs (USDC, USD) that scannerSymbols excludes
      assert.ok(allDataList.includes('BTCUSDC'), 'allDataSymbols should track BTCUSDC in data layer');
      assert.ok(allDataList.includes('BTCUSD'), 'allDataSymbols should track BTCUSD in data layer');
      assert.ok(!scannerList.includes('BTCUSDC'), 'scannerSymbols must not include BTCUSDC');
      assert.ok(!scannerList.includes('BTCUSD'), 'scannerSymbols must not include BTCUSD');

      // Superset size assertion
      assert.ok(allDataList.length > scannerList.length, 'allDataSymbols must be a strict superset when non-USDT pairs exist');
      assert.equal(scannerList.length, 4); // BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT
      assert.equal(allDataList.length, 7); // + BTCUSDC, ETHUSDC, BTCUSD (USDCUSDT & USD1USDT excluded)
    });
  } finally {
    symbolManager.symbolNames = originalSymbols;
  }
});
