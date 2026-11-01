import { describe, expect, test } from 'bun:test';
import { formatNativeUsdc, nativeToUsdcUnits, parseUsdcUnits, splitOrder, usdcUnitsToNative } from '../src/lib/money';

describe('money', () => {
  test('parses USDC input into 6-decimal units', () => {
    expect(parseUsdcUnits('1')).toBe(1_000_000n);
    expect(parseUsdcUnits('0.01')).toBe(10_000n);
    expect(parseUsdcUnits('12.345678')).toBe(12_345_678n);
    expect(parseUsdcUnits(' 5.5 ')).toBe(5_500_000n);
  });

  test('rejects malformed or over-precise input', () => {
    for (const bad of ['', 'abc', '-1', '1.1234567', '1,5', '1e3', '.5', '1.']) expect(parseUsdcUnits(bad)).toBeNull();
  });

  test('converts between the 6-decimal and 18-decimal views losslessly', () => {
    expect(usdcUnitsToNative(1_000_000n)).toBe(10n ** 18n);
    expect(nativeToUsdcUnits(10n ** 18n)).toBe(1_000_000n);
    const units = 123_456_789n;
    expect(nativeToUsdcUnits(usdcUnitsToNative(units))).toBe(units);
    expect(usdcUnitsToNative(units) % 10n ** 12n).toBe(0n);
  });

  test('formats native values for display', () => {
    expect(formatNativeUsdc(10n ** 18n)).toBe('1.00');
    expect(formatNativeUsdc(1_500_000n * 10n ** 12n)).toBe('1.50');
    expect(formatNativeUsdc(1_234_567_890_000n * 10n ** 12n)).toBe('1,234,567.89');
    expect(formatNativeUsdc(1n * 10n ** 12n)).toBe('0.000001');
    expect(formatNativeUsdc(0n)).toBe('0.00');
  });

  test('split mirrors the contract: deposit rounds down, reserve is the remainder', () => {
    const amount = usdcUnitsToNative(1_000_001n);
    const { deposit, reserve } = splitOrder(amount, 3000);
    expect(deposit + reserve).toBe(amount);
    expect(deposit).toBe((amount * 3000n) / 10_000n);
    expect(splitOrder(amount, 1).deposit).toBeGreaterThan(0n);
  });
});
