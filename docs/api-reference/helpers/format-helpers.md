# Format Helpers API

Generic formatting utilities for consistent data presentation across the FUM Library.

## Overview

The Format Helpers module provides a collection of utilities for formatting various data types including prices, token amounts, fees, and timestamps. These functions ensure consistent and user-friendly display of numerical and temporal data throughout the application.

## Functions

---

## formatPrice

Formats a price value with appropriate precision based on its magnitude.

### Signature
```javascript
formatPrice(price: number): string
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| price | `number` | Yes | - | The price value to format |

### Returns

`string` - The formatted price with appropriate precision

### Return Values

| Condition | Return Value | Example |
|-----------|--------------|---------|
| Not finite | `"N/A"` | `formatPrice(NaN)` → `"N/A"` |
| Zero | `"0"` | `formatPrice(0)` → `"0"` |
| < 0.0001 | `"<0.0001"` | `formatPrice(0.00005)` → `"<0.0001"` |
| < 0.001 | 6 decimal places | `formatPrice(0.0005)` → `"0.000500"` |
| < 0.1 | 5 decimal places | `formatPrice(0.05)` → `"0.05000"` |
| < 1 | 4 decimal places | `formatPrice(0.5)` → `"0.5000"` |
| < 100 | 2 decimal places | `formatPrice(50.5)` → `"50.50"` |
| > 1,000,000 | Exponential notation | `formatPrice(5000000)` → `"5.00e+6"` |
| Other | Locale string with max 2 decimals | `formatPrice(1234.56)` → `"1,234.56"` |

### Examples

```javascript
// Very small price
formatPrice(0.00003); // "<0.0001"

// Small price with precision
formatPrice(0.0123); // "0.01230"

// Standard price
formatPrice(42.5); // "42.50"

// Large price with locale formatting
formatPrice(1234.567); // "1,234.57"

// Very large price
formatPrice(5000000); // "5.00e+6"

// Invalid input
formatPrice(NaN); // "N/A"
```

### Side Effects
None - Pure function

### Test Coverage
- ✅ Zero values
- ✅ Very small numbers
- ✅ Various magnitude ranges
- ✅ Large numbers with exponential notation
- ✅ Invalid/non-finite inputs
- ✅ Locale string formatting

---

## formatUnits

Converts BigInt token amounts to human-readable strings with proper decimal placement.

### Signature
```javascript
formatUnits(value: BigInt, decimals: number): string
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| value | `BigInt` | Yes | - | The raw token amount as BigInt |
| decimals | `number` | Yes | - | Number of decimal places for the token |

### Returns

`string` - Formatted string representation with proper decimal placement

### Examples

```javascript
// 1 ETH (18 decimals)
formatUnits(1000000000000000000n, 18); // "1"

// 1.5 USDC (6 decimals)
formatUnits(1500000n, 6); // "1.5"

// 0.123456789 ETH
formatUnits(123456789000000000n, 18); // "0.123456789"

// Removes trailing zeros
formatUnits(1230000n, 6); // "1.23"

// Zero value
formatUnits(0n, 18); // "0"

// Null/undefined handling
formatUnits(null, 6); // "0"
```

### Important Notes

⚠️ **WARNING**: This function is for display purposes only. DO NOT use for calculations as it returns a string representation that loses precision.

### Errors

This function does not throw errors but will return "0" for falsy values.

### Side Effects
None - Pure function

### Test Coverage
- ✅ Standard token amounts
- ✅ Fractional amounts
- ✅ Trailing zero removal
- ✅ Zero values
- ✅ Null/undefined handling
- ✅ Various decimal precisions

---

## formatFeeDisplay

Formats fee values for display with a maximum of 4 decimal places.

### Signature
```javascript
formatFeeDisplay(value: string | number): string
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| value | `string \| number` | Yes | - | The fee value to format |

### Returns

`string` - Formatted fee display with trailing zeros removed

### Examples

```javascript
// Zero fee
formatFeeDisplay(0); // "0"
formatFeeDisplay("0"); // "0"

// Very small fee
formatFeeDisplay(0.00005); // "< 0.0001"

// Standard fees
formatFeeDisplay(0.003); // "0.003"
formatFeeDisplay("0.5000"); // "0.5"
formatFeeDisplay(1.2345); // "1.2345"

// Removes trailing zeros
formatFeeDisplay(0.1000); // "0.1"
formatFeeDisplay("0.0300"); // "0.03"
```

### Side Effects
None - Pure function

### Test Coverage
- ✅ Zero values
- ✅ Very small values below threshold
- ✅ Standard fee percentages
- ✅ Trailing zero removal
- ✅ String and number inputs

---

## formatTimestamp

Converts Unix timestamps to human-readable date and time strings.

### Signature
```javascript
formatTimestamp(timestamp: number): string
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| timestamp | `number` | Yes | - | Unix timestamp in milliseconds or seconds |

### Returns

`string` - Formatted date and time string in locale format

### Return Values

| Condition | Return Value |
|-----------|--------------|
| Falsy value | `"N/A"` |
| Invalid date | `"Invalid Date"` |
| Error during formatting | `"Error"` |
| Valid timestamp | Locale-formatted date string |

### Examples

```javascript
// Timestamp in seconds (auto-converted to milliseconds)
formatTimestamp(1679750400); // "Mar 25, 2023, 14:30"

// Timestamp in milliseconds
formatTimestamp(1679750400000); // "Mar 25, 2023, 14:30"

// Invalid inputs
formatTimestamp(null); // "N/A"
formatTimestamp(0); // "N/A"
formatTimestamp("invalid"); // "Invalid Date"

// Current time
formatTimestamp(Date.now()); // "Jan 13, 2025, 09:45"
```

### Features

- Automatically detects and converts seconds to milliseconds
- Uses browser locale for formatting
- Handles invalid dates gracefully
- Console logs errors for debugging

### Side Effects
- Logs errors to console when formatting fails

### Test Coverage
- ✅ Timestamps in seconds
- ✅ Timestamps in milliseconds
- ✅ Null/undefined handling
- ✅ Invalid date handling
- ✅ Locale formatting
- ✅ Error cases

---

## Type Definitions

```typescript
// For TypeScript users
type FormattedPrice = string;
type FormattedUnits = string;
type FormattedFee = string;
type FormattedTimestamp = string;
```

## See Also

- [`tokenHelpers`](./token-helpers.md) - Token-specific formatting utilities
- [`chainHelpers`](./chain-helpers.md) - Chain-specific formatting functions
- [BigInt MDN Documentation](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt)
- [Date.toLocaleString() MDN Documentation](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toLocaleString)