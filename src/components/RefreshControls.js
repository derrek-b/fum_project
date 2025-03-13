// src/components/RefreshControls.js
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Button, Form } from 'react-bootstrap';
import { setAutoRefresh, triggerUpdate } from '../redux/updateSlice';

export default function RefreshControls() {
  const dispatch = useDispatch();
  const { autoRefresh, isUpdating } = useSelector(state => state.updates);

  const toggleAutoRefresh = () => {
    dispatch(setAutoRefresh({ enabled: !autoRefresh.enabled }));
  };

  const changeInterval = (event) => {
    const interval = parseInt(event.target.value) * 1000; // Convert seconds to ms
    dispatch(setAutoRefresh({ interval }));
  };

  const handleManualRefresh = () => {
    dispatch(triggerUpdate());
  };

  return (
    <div className="d-flex align-items-center">
      <Button
        variant="outline-secondary"
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
          label="Auto-refresh"
          checked={autoRefresh.enabled}
          onChange={toggleAutoRefresh}
          className="me-2"
        />

        {autoRefresh.enabled && (
          <Form.Select
            size="sm"
            value={autoRefresh.interval / 1000}
            onChange={changeInterval}
            style={{ width: '80px' }}
          >
            <option value="15">15s</option>
            <option value="30">30s</option>
            <option value="60">1m</option>
            <option value="300">5m</option>
          </Form.Select>
        )}
      </div>
    </div>
  );
}
