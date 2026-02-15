// components/common/AutomationStatus.js
import { useSelector } from 'react-redux';

/**
 * Small status indicator showing automation service connection status
 * Can be added to Navbar or any layout component
 */
export default function AutomationStatus({ showLabel = true, size = 'sm' }) {
  const { connected, stats } = useSelector((state) => state.automation);

  const dotSize = size === 'sm' ? '8px' : size === 'md' ? '10px' : '12px';
  const fontSize = size === 'sm' ? '0.75rem' : size === 'md' ? '0.85rem' : '1rem';

  return (
    <div
      className="d-flex align-items-center gap-1"
      title={connected
        ? `Connected - ${stats.eventsReceived} events received`
        : 'Disconnected from automation service'
      }
    >
      <span
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: '50%',
          backgroundColor: connected ? '#28a745' : '#dc3545',
          display: 'inline-block',
          animation: connected ? 'pulse 2s infinite' : 'none'
        }}
      />
      {showLabel && (
        <span style={{ fontSize, color: connected ? '#28a745' : '#dc3545' }}>
          {connected ? 'Live' : 'Offline'}
        </span>
      )}
      <style jsx>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
