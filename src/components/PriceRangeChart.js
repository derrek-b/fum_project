import React from 'react';
import { useToast } from '../context/ToastContext';

const PriceRangeChart = ({
  lowerPrice,
  upperPrice,
  currentPrice,
  token0Symbol,
  token1Symbol,
  isInverted,
  isActive
}) => {
  const { showError } = useToast();

  // Validate inputs and handle edge cases
  const validateInputs = () => {
    try {
      // Convert inputs to numbers if they're strings
      const lower = typeof lowerPrice === 'string' ? parseFloat(lowerPrice) : lowerPrice;
      const upper = typeof upperPrice === 'string' ? parseFloat(upperPrice) : upperPrice;
      const current = typeof currentPrice === 'string' ? parseFloat(currentPrice) : currentPrice;

      // Check if prices are valid numbers
      if (isNaN(lower) || isNaN(upper) || isNaN(current)) {
        console.error("Invalid price values:", { lowerPrice, upperPrice, currentPrice });
        return { valid: false };
      }

      // Check if range is valid (lower should be less than upper)
      if (lower >= upper) {
        console.error("Invalid price range: lower price must be less than upper price", { lower, upper });
        return { valid: false };
      }

      return {
        valid: true,
        lowerPrice: lower,
        upperPrice: upper,
        currentPrice: current
      };
    } catch (error) {
      console.error("Error validating price inputs:", error);
      showError("Error validating price data");
      return { valid: false };
    }
  };

  // Run validation
  const validation = validateInputs();

  // If validation fails, show placeholder
  if (!validation.valid) {
    return (
      <div className="text-center pt-5 mt-3">
        <p className="text-muted">Chart visualization unavailable</p>
      </div>
    );
  }

  // Use validated values
  const { lowerPrice: lower, upperPrice: upper, currentPrice: current } = validation;

  try {
    // Calculate position within range (as percentage)
    let rangePct = 0;

    // Handle division by zero or very small denominators
    if (Math.abs(upper - lower) < 0.000001) {
      rangePct = 50; // If range is too small, just put marker in the middle
    } else {
      // Calculate percentage and clamp between 0-100
      rangePct = Math.min(Math.max(((current - lower) / (upper - lower)) * 100, 0), 100);
    }

    // For display purposes - handle potential formatting errors
    let displayLower = "N/A";
    let displayUpper = "N/A";
    let displayCurrent = "N/A";

    try {
      displayLower = lower.toFixed(2);
      displayUpper = upper.toFixed(2);
      displayCurrent = current.toFixed(2);
    } catch (formatError) {
      console.error("Error formatting price values:", formatError);
    }

    // Generate token pair label with fallbacks
    const token0 = token0Symbol || "Token0";
    const token1 = token1Symbol || "Token1";
    const pairLabel = isInverted
      ? `${token0} per ${token1}`
      : `${token1} per ${token0}`;

    const activeColor = '#28a745'; // Success green
    const inactiveColor = '#dc3545'; // Danger red
    const chartColor = isActive ? activeColor : inactiveColor;

    // Styles for the chart
    const chartStyles = {
      container: {
        position: 'relative',
        width: '100%',
        height: '100%',
        padding: '10px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between'
      },
      rangeBar: {
        position: 'relative',
        height: '40px',
        backgroundColor: '#f0f0f0',
        borderRadius: '20px',
        marginTop: '20px',
        marginBottom: '10px'
      },
      activeRange: {
        position: 'absolute',
        height: '100%',
        backgroundColor: chartColor,
        opacity: 0.4,
        left: '25%',
        width: '50%',
        borderRadius: '20px'
      },
      priceMarker: {
        position: 'absolute',
        width: '3px',
        height: '50px',
        backgroundColor: '#000',
        left: `${rangePct}%`,
        top: '-5px'
      },
      priceLabel: {
        position: 'absolute',
        left: `${rangePct}%`,
        top: '-25px',
        transform: 'translateX(-50%)',
        backgroundColor: '#fff',
        padding: '2px 6px',
        borderRadius: '4px',
        border: '1px solid #ccc',
        fontSize: '12px',
        fontWeight: 'bold'
      },
      lowerPriceLabel: {
        position: 'absolute',
        left: '25%',
        bottom: '-25px',
        transform: 'translateX(-50%)',
        fontSize: '12px'
      },
      upperPriceLabel: {
        position: 'absolute',
        left: '75%',
        bottom: '-25px',
        transform: 'translateX(-50%)',
        fontSize: '12px'
      },
      footer: {
        marginTop: '30px',
        fontSize: '12px',
        textAlign: 'center',
        color: '#666'
      }
    };

    return (
      <div style={chartStyles.container}>
        <div style={chartStyles.rangeBar}>
          {/* Active price range */}
          <div
            style={{
              ...chartStyles.activeRange,
              left: '25%',
              width: '50%'
            }}
          />

          {/* Current price marker */}
          <div
            style={{
              ...chartStyles.priceMarker,
              left: `${25 + rangePct/2}%`
            }}
          />

          {/* Current price label */}
          <div
            style={{
              ...chartStyles.priceLabel,
              left: `${25 + rangePct/2}%`
            }}
          >
            {displayCurrent}
          </div>

          {/* Lower price label */}
          <div style={chartStyles.lowerPriceLabel}>
            {displayLower}
          </div>

          {/* Upper price label */}
          <div style={chartStyles.upperPriceLabel}>
            {displayUpper}
          </div>
        </div>

        <div style={chartStyles.footer}>
          Price range in {pairLabel}
          <div className="mt-1">
            <small className="text-muted">
              Note: This is a simplified visualization. In a production app,
              we would use a charting library like Chart.js or Recharts.
            </small>
          </div>
        </div>
      </div>
    );
  } catch (error) {
    console.error("Error rendering price range chart:", error);
    showError("Error rendering price chart");

    return (
      <div className="text-center pt-5 mt-3">
        <p className="text-muted">Chart visualization unavailable</p>
      </div>
    );
  }
};

export default PriceRangeChart;
