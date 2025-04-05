// src/components/vault_wizard/StrategyConfigPanel.js
import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Card, Form, Button, Alert, Spinner } from 'react-bootstrap';
import { getAvailableStrategies } from '../utils/strategyConfig';

const StrategyConfigPanel = ({
  vaultAddress,
  isOwner,
  strategyConfig,
  strategyActive,
  performance,
  onStrategyToggle
}) => {
  const dispatch = useDispatch();

  // Get the vault from Redux
  const vault = useSelector((state) =>
    state.vaults.userVaults.find(v => v.address === vaultAddress)
  );

  // Get available strategies
  const [availableStrategies, setAvailableStrategies] = useState([]);
  const [selectedStrategy, setSelectedStrategy] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [automationEnabled, setAutomationEnabled] = useState(false);

  // Change tracking
  const [initialAutomationState, setInitialAutomationState] = useState(false);
  const [initialSelectedStrategy, setInitialSelectedStrategy] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Load available strategies and set initial state on component mount
  useEffect(() => {
    // Get all strategies except 'none'
    const strategies = getAvailableStrategies();
    setAvailableStrategies(strategies);

    // Set automation toggle based on vault's active strategy status
    const hasStrategy = vault?.hasActiveStrategy || false;
    setAutomationEnabled(hasStrategy);
    setInitialAutomationState(hasStrategy);

    // If vault has an active strategy, set it as selected
    if (vault?.hasActiveStrategy) {
      // For now, we'll just assume "fed" is the active strategy
      // In a real implementation, you would get this from the vault or strategyConfig
      const activeStrategy = 'fed';
      setSelectedStrategy(activeStrategy);
      setInitialSelectedStrategy(activeStrategy);
    } else {
      setSelectedStrategy('');
      setInitialSelectedStrategy('');
    }
  }, [vault]);

  // Check for unsaved changes whenever relevant state changes
  useEffect(() => {
    const hasChanges =
      automationEnabled !== initialAutomationState ||
      (automationEnabled && selectedStrategy !== initialSelectedStrategy);

    setHasUnsavedChanges(hasChanges);
  }, [automationEnabled, selectedStrategy, initialAutomationState, initialSelectedStrategy]);

  // Handle strategy selection change
  const handleStrategyChange = (e) => {
    setSelectedStrategy(e.target.value);
  };

  // Handle automation toggle
  const handleAutomationToggle = (e) => {
    const isEnabled = e.target.checked;
    setAutomationEnabled(isEnabled);
  };

  // Render the strategy config panel
  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h4 className="mb-0">Strategy Configuration</h4>
          {hasUnsavedChanges && (
            <Alert variant="danger" className="py-1 px-2 mb-0">
              <strong>Unsaved changes</strong>
            </Alert>
          )}
        </div>

        <p>Configure automated management strategies for this vault's positions and tokens.</p>

        <Form.Check
          type="switch"
          id="automation-switch"
          label="Use automated position management"
          checked={automationEnabled}
          onChange={handleAutomationToggle}
          disabled={!isOwner}
          className="mb-4"
        />

        {automationEnabled && (
          <>
            <div className="mb-4">
              <Form.Group>
                <Form.Label><strong>Select Strategy</strong></Form.Label>
                <Form.Select
                  value={selectedStrategy}
                  onChange={handleStrategyChange}
                  disabled={!isOwner || (vault?.hasActiveStrategy && !hasUnsavedChanges)}
                  className="mb-3"
                >
                  <option value="">Select a strategy</option>
                  {availableStrategies.map(strategy => (
                    <option key={strategy.id} value={strategy.id}>
                      {strategy.name} - {strategy.subtitle}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>

              {isOwner && hasUnsavedChanges && (
                <div className="d-grid mt-2">
                  <Button
                    variant="primary"
                    onClick={() => {
                      // This would eventually save the changes to the chain
                      // For now, we'll just update the toggle state based on selection
                      const activate = automationEnabled && selectedStrategy !== '';
                      onStrategyToggle(activate);

                      // After saving, this would update initial states
                      // setInitialAutomationState(automationEnabled);
                      // setInitialSelectedStrategy(selectedStrategy);
                    }}
                    disabled={isLoading || (automationEnabled && !selectedStrategy)}
                  >
                    {isLoading ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" />
                        Saving changes...
                      </>
                    ) : (
                      "Save Changes"
                    )}
                  </Button>
                </div>
              )}

              {isOwner && !hasUnsavedChanges && vault?.hasActiveStrategy && (
                <div className="d-grid mt-2">
                  <Button
                    variant="danger"
                    onClick={() => onStrategyToggle(false)}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" />
                        Deactivating strategy...
                      </>
                    ) : (
                      "Deactivate Strategy"
                    )}
                  </Button>
                </div>
              )}
            </div>

            {hasUnsavedChanges && (
              <Alert variant="warning">
                Strategy changes have not been saved. Click "Save Changes" to apply your configuration.
              </Alert>
            )}

            <h5 className="mt-4">Strategy Details</h5>
            <div className="strategy-details p-3 border rounded bg-light">
              {(!automationEnabled || (!vault?.hasActiveStrategy && !selectedStrategy)) ? (
                <Alert variant="info">
                  No strategy established for the vault. Select a strategy and activate it to enable automated management.
                </Alert>
              ) : (
                <Alert variant="success">
                  That is one tasty burger mother f*$@%r{selectedStrategy ? `, ${selectedStrategy}` : ''}!
                </Alert>
              )}
            </div>
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default StrategyConfigPanel;
