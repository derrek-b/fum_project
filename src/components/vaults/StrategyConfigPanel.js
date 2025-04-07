// src/components/StrategyConfigPanel.js
import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Card, Form, Button, Alert, Spinner, Badge } from 'react-bootstrap';
import { getAvailableStrategies } from '../../utils/strategyConfig';
import StrategyDetailsSection from './vault_wizard/StrategyDetailsSection';
import { updateVaultStrategy } from '../../redux/vaultsSlice';
import { triggerUpdate } from '../../redux/updateSlice';

const StrategyConfigPanel = ({
  vaultAddress,
  isOwner,
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
  const [strategyParams, setStrategyParams] = useState({});
  const [selectedTokens, setSelectedTokens] = useState([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [validateFn, setValidateFn] = useState(null);

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
    const hasStrategy = vault?.hasActiveStrategy || strategyActive || false;
    setAutomationEnabled(hasStrategy);
    setInitialAutomationState(hasStrategy);

    // If vault has an active strategy, set it as selected
    if (vault?.strategy?.strategyId) {
      // Get strategy from vault
      const activeStrategy = vault.strategy.strategyId;
      setSelectedStrategy(activeStrategy);
      setInitialSelectedStrategy(activeStrategy);
    } else if (vault?.hasActiveStrategy || strategyActive) {
      // Fallback to 'fed' if we know there's a strategy but don't have details
      setSelectedStrategy('fed');
      setInitialSelectedStrategy('fed');
    } else {
      setSelectedStrategy('');
      setInitialSelectedStrategy('');
    }
  }, [vault, strategyActive]);

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
    setEditMode(true);
  };

  // Handle automation toggle
  const handleAutomationToggle = (e) => {
    const isEnabled = e.target.checked;
    setAutomationEnabled(isEnabled);

    // If toggling off automation, clear the selected strategy
    if (!isEnabled) {
      setSelectedStrategy('');
      setEditMode(false);
    }
  };

  // Handle edit request from child component
  const handleEditRequest = () => {
    setEditMode(true);
  };

  // Handle parameter changes
  const handleParamsChange = (paramData) => {
    if (paramData.parameters) {
      setStrategyParams(paramData.parameters);
    }

    // Store token and platform selections too
    if (paramData.selectedTokens) {
      setSelectedTokens(paramData.selectedTokens);
    }

    if (paramData.selectedPlatforms) {
      setSelectedPlatforms(paramData.selectedPlatforms);
    }
  };

  // Set validation function
  const handleSetValidation = (validateFn) => {
    // Only update if it's actually different to avoid re-renders
    if (validateFn !== validateFn) {
      setValidateFn(() => validateFn);
    }
  };

  // Handle save button click
  const handleSave = () => {
    console.log("Where's my tasty beverage b*^$h?");

    // Call validation function if available
    if (typeof validateFn === 'function') {
      const isValid = validateFn();
      if (!isValid) {
        return;
      }
    }

    // Here you would save the parameters to the contract

    // Update initial states to reflect saved state
    setInitialAutomationState(automationEnabled);
    setInitialSelectedStrategy(selectedStrategy);
    setHasUnsavedChanges(false);

    // Exit edit mode
    setEditMode(false);
  };

  // Handle cancel button click
  const handleCancel = () => {
    // If we were just setting up a new strategy, revert to original
    if (selectedStrategy !== initialSelectedStrategy) {
      setSelectedStrategy(initialSelectedStrategy);
    }

    if (automationEnabled !== initialAutomationState) {
      setAutomationEnabled(initialAutomationState);
    }

    setHasUnsavedChanges(false);
    setEditMode(false);
  };

  // Render the strategy config panel
  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h4 className="mb-0">Strategy Configuration</h4>
          {hasUnsavedChanges && (
            <Badge bg="danger" className="py-1 px-2">
              Unsaved changes
            </Badge>
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
            </div>

            <h5 className="mt-4">Strategy Details</h5>
            <div className="strategy-details p-3 border rounded bg-light">
              {(!automationEnabled || (!vault?.hasActiveStrategy && !selectedStrategy)) ? (
                <Alert variant="info">
                  No strategy established for the vault. Select a strategy and activate it to enable automated management.
                </Alert>
              ) : (
                <StrategyDetailsSection
                  vaultAddress={vaultAddress}
                  isOwner={isOwner}
                  strategyId={selectedStrategy}
                  strategyActive={strategyActive && !hasUnsavedChanges}
                  editMode={editMode}
                  onEditRequest={handleEditRequest}
                  onCancel={handleCancel}
                  onValidate={handleSetValidation}
                  onParamsChange={handleParamsChange}
                />
              )}
            </div>

            {/* Save/Cancel buttons at the bottom */}
            {isOwner && (editMode || hasUnsavedChanges) && (
              <div className="d-flex justify-content-end mt-4">
                <Button
                  variant="outline-secondary"
                  onClick={handleCancel}
                  className="me-2"
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSave}
                >
                  Save Configuration
                </Button>
              </div>
            )}

            {isOwner && !editMode && !hasUnsavedChanges && vault?.hasActiveStrategy && (
              <div className="d-flex justify-content-end mt-4">
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
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default StrategyConfigPanel;
