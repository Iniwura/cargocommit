// Arc exposes one pool of USDC through two views:
//   native view  : 18 decimals, used for msg.value and gas
//   ERC-20 view  : 6 decimals, used for balances and display
// Seldra contracts account in native units. Everything shown to people is in the 6-decimal view.
// Convert only with the helpers in this file.

export const NATIVE_DECIMALS = 18;
export const USDC_DECIMALS = 6;
export const NATIVE_PER_USDC_UNIT = 10n ** BigInt(NATIVE_DECIMALS - USDC_DECIMALS);
export const BPS = 10_000n;

/** Arc's USDC ERC-20 predeploy, identical on every Arc network (Circle Arc docs). */
export const ARC_USDC_ERC20 = '0x3600000000000000000000000000000000000000' as const;

const AMOUNT_PATTERN = /^\d+(\.\d{1,6})?$/;

/** Parses a user-typed USDC amount (max 6 decimals) into 6-decimal units. Returns null when invalid. */
export function parseUsdcUnits(input: string): bigint | null {
  const value = input.trim();
  if (!AMOUNT_PATTERN.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(fraction.padEnd(USDC_DECIMALS, '0'));
}

export function usdcUnitsToNative(units: bigint): bigint {
  return units * NATIVE_PER_USDC_UNIT;
}

export function nativeToUsdcUnits(native: bigint): bigint {
  return native / NATIVE_PER_USDC_UNIT;
}

/** Native 18-decimal value to a 6-decimal USDC display string, e.g. 1500000000000000000n -> "1.50". */
export function formatNativeUsdc(native: bigint, minFraction = 2): string {
  const units = nativeToUsdcUnits(native);
  const whole = units / 10n ** BigInt(USDC_DECIMALS);
  const fraction = (units % 10n ** BigInt(USDC_DECIMALS)).toString().padStart(USDC_DECIMALS, '0');
  let trimmed = fraction.replace(/0+$/, '');
  if (trimmed.length < minFraction) trimmed = fraction.slice(0, minFraction);
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return trimmed.length > 0 ? `${wholeText}.${trimmed}` : wholeText;
}

/** ERC-20 view (6 decimals) display string. */
export function formatUsdcUnits(units: bigint, minFraction = 2): string {
  return formatNativeUsdc(usdcUnitsToNative(units), minFraction);
}

/** Mirrors SeldraOrder: deposit = amount * bps / 10000, reserve = amount - deposit. */
export function splitOrder(orderAmountNative: bigint, depositBps: number) {
  const deposit = (orderAmountNative * BigInt(depositBps)) / BPS;
  return { deposit, reserve: orderAmountNative - deposit };
}
