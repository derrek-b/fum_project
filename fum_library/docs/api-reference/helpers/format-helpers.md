<!-- Source: src/helpers/formatHelpers.js -->
# Format Helpers API

Generic formatting utilities for consistent data presentation across the FUM Library.

## Overview

The Format Helpers module provides three pure formatting functions for numerical and temporal display. All functions validate inputs and throw descriptive errors on invalid data (fail-fast) — they do not return sentinel strings like `"N/A"` or `"Invalid Date"`.

## Exports

```javascript
import {
  formatPrice,
  formatFeeDisplay,
  formatTimestamp
} from 'fum_library/helpers/formatHelpers';
```

## Functions

---

### formatPrice

Formats a price value with appropriate precision based on its magnitude. Returns abbreviated format (`M`, `B`) for very large values. Output uses `Number.prototype.toFixed` — no thousands separators are inserted.

#### Signature
```javascript
formatPrice(price: number): string
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| price | `number` | Yes | The price value to format. Must be finite and `>= 0`. |

#### Returns

`string` — Formatted price. Format varies by magnitude:

| Condition | Return Value | Example |
|-----------|--------------|---------|
| Zero | `"0"` | `formatPrice(0)` → `"0"` |
| `< 0.0001` | `"<0.0001"` | `formatPrice(0.00005)` → `"<0.0001"` |
| `< 0.001` | 6 decimal places | `formatPrice(0.0005)` → `"0.000500"` |
| `< 0.1` | 5 decimal places | `formatPrice(0.05)` → `"0.05000"` |
| `< 1000` | 4 decimal places | `formatPrice(50.5)` → `"50.5000"` |
| `< 1,000,000` | 2 decimal places | `formatPrice(1234.56)` → `"1234.56"` |
| `>= 1,000,000` | `"N.NNM"` abbreviated | `formatPrice(5000000)` → `"5.00M"` |
| `>= 1,000,000,000` | `"N.NNB"` abbreviated | `formatPrice(1500000000)` → `"1.50B"` |

#### Throws

| Error | Condition |
|-------|-----------|
| `Error: Price must be a finite number` | price is `NaN`, `Infinity`, `null`, `undefined`, or non-numeric |
| `Error: Price cannot be negative` | price is `< 0` |

#### Examples

```javascript
// Very small price
formatPrice(0.00003);      // "<0.0001"

// Small price with extra precision
formatPrice(0.0123);       // "0.01230"

// Standard price
formatPrice(42.5);         // "42.5000"

// Large price
formatPrice(1234.56);      // "1234.56"

// Millions
formatPrice(5000000);      // "5.00M"

// Billions
formatPrice(1500000000);   // "1.50B"

// Invalid input
formatPrice(NaN);          // throws: "Price must be a finite number"
formatPrice(-1);           // throws: "Price cannot be negative"
```

#### Side Effects
None — pure function.

---

### formatFeeDisplay

Formats fee values with up to 4 decimal places, trailing zeros removed.

#### Signature
```javascript
formatFeeDisplay(fee: number): string
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| fee | `number` | Yes | The fee value to format. Must be finite and `>= 0`. |

#### Returns

`string` — Formatted fee display:

| Condition | Return Value | Example |
|-----------|--------------|---------|
| Zero | `"0"` | `formatFeeDisplay(0)` → `"0"` |
| `< 0.0001` | `"< 0.0001"` | `formatFeeDisplay(0.00005)` → `"< 0.0001"` |
| Otherwise | Up to 4 decimals, trailing zeros removed | `formatFeeDisplay(0.0300)` → `"0.03"` |

#### Throws

| Error | Condition |
|-------|-----------|
| `Error: Fee must be a finite number` | fee is `NaN`, `Infinity`, or non-numeric |
| `Error: Fee cannot be negative` | fee is `< 0` |

#### Examples

```javascript
formatFeeDisplay(0);          // "0"
formatFeeDisplay(0.00005);    // "< 0.0001"
formatFeeDisplay(0.003);      // "0.003"
formatFeeDisplay(0.0300);     // "0.03"    (trailing zeros trimmed)
formatFeeDisplay(1.2345);     // "1.2345"
formatFeeDisplay(1.23456);    // "1.2346"  (rounded to 4 decimals)
```

#### Side Effects
None — pure function.

---

### formatTimestamp

Converts Unix timestamps (seconds or milliseconds) to locale-formatted date strings.

#### Signature
```javascript
formatTimestamp(timestamp: number): string
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| timestamp | `number` | Yes | Unix timestamp in seconds or milliseconds. Must be finite and `> 0`. |

#### Returns

`string` — Locale-formatted date string (e.g., `"Mar 25, 2023, 14:30"`).

Format uses `toLocaleString` with: `year: 'numeric'`, `month: 'short'`, `day: 'numeric'`, `hour: '2-digit'`, `minute: '2-digit'`.

Auto-detects seconds vs milliseconds using threshold of 10 billion (10^10): values below are treated as seconds and multiplied by 1000.

#### Throws

| Error | Condition |
|-------|-----------|
| `Error: Timestamp must be a finite number` | timestamp is `NaN`, `Infinity`, `null`, `undefined`, or non-numeric |
| `Error: Timestamp must be greater than 0` | timestamp is `<= 0` |
| `Error: Timestamp creates an invalid date` | conversion yields an invalid `Date` |

#### Examples

```javascript
// Timestamp in seconds (auto-converted to milliseconds)
formatTimestamp(1679750400);      // "Mar 25, 2023, 14:30"

// Timestamp in milliseconds
formatTimestamp(1679750400000);   // "Mar 25, 2023, 14:30"

// Invalid inputs
formatTimestamp(null);            // throws: "Timestamp must be a finite number"
formatTimestamp(0);               // throws: "Timestamp must be greater than 0"
formatTimestamp(-1);              // throws: "Timestamp must be greater than 0"
```

#### Side Effects
None — pure function. Throws on invalid input rather than logging to console.

---

## See Also

- [`tokenHelpers`](./token-helpers.md) — Token-specific utilities
- [`chainHelpers`](./chain-helpers.md) — Chain configuration utilities
- [Date.toLocaleString() MDN Documentation](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toLocaleString)
