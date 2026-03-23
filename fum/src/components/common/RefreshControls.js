// src/components/RefreshControls.js - simplified version
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Button, Form } from 'react-bootstrap';
import { setAutoRefresh } from '../../redux/updateSlice';
import { setPositionsLastFetched } from '../../redux/positionsSlice';
import { setVaultsLastFetched } from '../../redux/vaultsSlice';
import { useToast } from '../../context/ToastContext';
import { clearPriceCache } from 'fum_library/services';

export default function RefreshControls() {
  const dispatch = useDispatch();
  const { showError } = useToast();
  const { autoRefresh, isUpdating } = useSelector(state => state.updates);

  const toggleAutoRefresh = () => {
    try {
      dispatch(setAutoRefresh({ enabled: !autoRefresh.enabled }));
    } catch (error) {
      console.error("Error toggling auto-refresh:", error);
      showError("Failed to toggle auto-refresh setting");
    }
  };

  const handleManualRefresh = () => {
    try {
      // Clear price cache and invalidate freshness timestamps
      clearPriceCache();
      dispatch(setPositionsLastFetched(null));
      dispatch(setVaultsLastFetched(null));
    } catch (error) {
      console.error("Error triggering manual refresh:", error);
      showError("Failed to refresh data. Please try again.");
    }
  };

  return (
    <div className="d-flex align-items-center">
      <Button
        variant="outline-custom"
        size="sm"
        onClick={handleManualRefresh}
        disabled={isUpdating}
        className="me-3"
      >
        {isUpdating ? 'Refreshing...' : 'Refresh'}
      </Button>

      <div className="d-flex align-items-center small">
        <Form.Check
          type="switch"
          id="auto-refresh-toggle"
          label="Auto-refresh (30s)"
          checked={autoRefresh.enabled}
          onChange={toggleAutoRefresh}
          className="me-2"
        />
      </div>
    </div>
  );
}
