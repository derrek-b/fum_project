import React from 'react';

const PriceRangeChart = ({
  lowerPrice,
  upperPrice,
  currentPrice,
  token0Symbol,
  token1Symbol,
  isInverted,
  isActive
}) => {
  // If we don't have valid prices, show a placeholder
  if (!lowerPrice || !upperPrice || !currentPrice) {
    return (
      <div className="text-center pt-5 mt-3">
        <p className="text-muted">Chart visualization unavailable</p>
      </div>
    );
  }

  // Calculate position within range (as percentage)
  const rangePct = Math.min(Math.max(((currentPrice - lowerPrice) / (upperPrice - lowerPrice)) * 100, 0), 100);

  // For display purposes
  const displayLower = lowerPrice.toFixed(2);
  const displayUpper = upperPrice.toFixed(2);
  const displayCurrent = currentPrice.toFixed(2);

  // Generate token pair label
  const pairLabel = isInverted
    ? `${token0Symbol} per ${token1Symbol}`
    : `${token1Symbol} per ${token0Symbol}`;

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
};

export default PriceRangeChart;
