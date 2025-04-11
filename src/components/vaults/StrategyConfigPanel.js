// src/components/StrategyConfigPanel.js
import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useSelector, useDispatch } from 'react-redux';
import { Card, Form, Button, Alert, Spinner, Badge } from 'react-bootstrap';
import { getVaultContract, executeVaultTransactions } from '../../utils/contracts';
import contractData from '../../abis/contracts.json';
import { getAvailableStrategies, getStrategyParameters } from '../../utils/strategyConfig';
import StrategyDetailsSection from './StrategyDetailsSection';
import { updateVaultStrategy } from '../../redux/vaultsSlice';
import { triggerUpdate } from '../../redux/updateSlice';
import { useToast } from '@/context/ToastContext';

const StrategyConfigPanel = ({
  vaultAddress,
  isOwner,
  strategyActive,
  performance,
  //onStrategyToggle
}) => {
  const dispatch = useDispatch();
  const provider = useSelector(state => state.wallet.provider);
  const chainId = useSelector(state => state.wallet.chainId);
  const availableStrategies = useSelector(state => state.strategies.availableStrategies)

  // Get the vault from Redux
  const vault = useSelector((state) =>
    state.vaults.userVaults.find(v => v.address === vaultAddress)
  );

  // Get available strategies
  //const [availableStrategies, setAvailableStrategies] = useState([]);
  const [selectedStrategy, setSelectedStrategy] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [automationEnabled, setAutomationEnabled] = useState(false);
  const [activePreset, setActivePreset] = useState('custom');
  const [strategyParams, setStrategyParams] = useState({});
  const [selectedTokens, setSelectedTokens] = useState([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [validateFn, setValidateFn] = useState(null);
  const { showSuccess, showError } = useToast();

  // Change tracking
  const [initialAutomationState, setInitialAutomationState] = useState(false);
  const [initialSelectedStrategy, setInitialSelectedStrategy] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Load available strategies and set initial state on component mount
  useEffect(() => {
    // Get all strategies except 'none'
    //const strategies = getAvailableStrategies();
    //setAvailableStrategies(strategies);

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

    // If toggling off automation, start modal to get user confirmation
    if (!isEnabled) {
      console.log('disabling strategy...')
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

    if (paramData.activePreset) {
      setActivePreset(paramData.activePreset);
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
  const handleSave = async () => {
    // Validation
    if (typeof validateFn === 'function') {
      const isValid = validateFn();
      if (!isValid) return;
    }

    setIsLoading(true);

    try {
      if (!provider) {
        throw new Error("No provider available");
      }

      // Get signer with await
      const signer = await provider.getSigner();

      // Get the selected strategy details from the config
      const strategyConfig = getAvailableStrategies().find(s => s.id === selectedStrategy);
      if (!strategyConfig) {
        throw new Error(`Strategy configuration not found for ${selectedStrategy}`);
      }

      // Get the contract address for the selected strategy
      //const strategyAddress = strategyConfig.addresses?.[chainId.toString()];// Load strategy addresses from contracts.json
      let strategyAddress;
      Object.keys(contractData).forEach(contractKey => {
        // Skip non-strategy contracts
        if (['VaultFactory', 'PositionVault', 'BatchExecutor', 'ParrisIslandStrategy'].includes(contractKey)) {
          return;
        }

        strategyAddress = contractData[contractKey].addresses?.[chainId];
      });

      if (!strategyAddress) {
        throw new Error(`Strategy ${selectedStrategy} not deployed on this network (Chain ID: ${chainId})`);
      }

      // Get PositionVault contract instance
      const vaultContract = getVaultContract(vaultAddress, provider, signer);

      // Get strategy contract interface from config
      const strategyContract = new ethers.Contract(
        strategyAddress,
        contractData[selectedStrategy].abi,
        signer
      );

      // Check if the vault is authorized in the strategy contract
      // Note: This will only work if the strategy contract has this method
      let isAuthorized = false;
      try {
        isAuthorized = await strategyContract.authorizedVaults(vaultAddress);
      } catch (authCheckError) {
        console.warn("Strategy doesn't support vault authorization check:", authCheckError.message);
        // Continue anyway, the authorization call below will fail if needed
      }

      if (!isAuthorized) {
        try {
          // If not authorized, try to authorize it
          const authTx = await strategyContract.authorizeVault(vaultAddress);
          await authTx.wait();
        } catch (authError) {
          console.warn("Strategy doesn't support vault authorization or failed:", authError.message);
          // Continue anyway, the strategy might not require explicit authorization
        }
      }

      // PART 1: Direct calls to PositionVault contract

      // Step 1: Set strategy if needed
      if (!vault.strategyAddress || !vault.hasActiveStrategy) {
        const setStrategyTx = await vaultContract.setStrategy(strategyAddress);
        await setStrategyTx.wait();
      }

      // Step 2: Set target tokens if needed
      if (automationEnabled && selectedStrategy && selectedTokens.length > 0) {
        const setTokensTx = await vaultContract.setTargetTokens(selectedTokens);
        await setTokensTx.wait();
      }

      // Step 3: Set target platforms if needed
      if (automationEnabled && selectedStrategy && selectedPlatforms.length > 0) {
        const setPlatformsTx = await vaultContract.setTargetPlatforms(selectedPlatforms);
        await setPlatformsTx.wait();
      }

      // PART 2: Batch calls to Strategy contract through vault's execute function

      // Array to hold strategy transactions
      const strategyTransactions = [];

      // Get strategy-specific configuration for formatting parameters
      const parameterDefinitions = getStrategyParameters(selectedStrategy);
      // Step 4: Handle template selection if the strategy supports templates
      if (automationEnabled && selectedStrategy && activePreset && activePreset !== 'custom') {

        // Get the template enum mapping from the config if available
        const templateEnumMap = strategyConfig.templateEnumMap

        const templateValue = templateEnumMap[activePreset] || 0;

        strategyTransactions.push({
          target: strategyAddress,
          data: strategyContract.interface.encodeFunctionData("selectTemplate", [
            templateValue
          ]),
          description: `Select template: ${activePreset} (value: ${templateValue})`
        });
      }

      // Step 5: Set strategy parameters based on the strategy's parameter groups
      if (automationEnabled && selectedStrategy && (activePreset === 'custom' || hasUnsavedChanges)) {
        // Get parameter groups from config
        const parameterGroups = strategyConfig.parameterGroups || [];

        // Process each parameter group
        for (const group of parameterGroups) {
          // Get parameters for this group
          const groupParams = Object.entries(parameterDefinitions)
            .filter(([paramId, config]) => config.group === group.id)
            .map(([paramId, config]) => ({ paramId, config }));

          // Skip if no parameters in this group or setter method isn't defined
          if (groupParams.length === 0 || !group.setterMethod) continue;

          // Check if we have all required parameters
          const haveAllRequiredParams = groupParams.every(({ paramId }) =>
            strategyParams[paramId] !== undefined);

          if (!haveAllRequiredParams) continue;

          // Format parameters according to their types and add transaction
          const formattedParams = groupParams.map(({ paramId, config }) => {
            const value = strategyParams[paramId];

            // Format based on parameter type
            switch (config.type) {
              case 'percent':
                // Convert percentage to basis points (multiply by 100)
                return Math.round(parseFloat(value) * 100);

              case 'currency':
                // Convert to wei
                return ethers.parseUnits(value.toString(), 18);

              case 'boolean':
                return !!value;

              case 'select':
                // Use the raw value for select types (should be enum value)
                return value;

              default:
                // For other types, use the value as is
                return value;
            }
          });

          // Create transaction for this parameter group
          strategyTransactions.push({
            target: strategyAddress,
            data: strategyContract.interface.encodeFunctionData(group.setterMethod, formattedParams),
            description: `Set ${group.name.toLowerCase()} parameters`
          });
        }
      }

      // Execute strategy transactions if any
      if (strategyTransactions.length > 0) {

        // Extract targets and data for executeVaultTransactions
        const targets = strategyTransactions.map(tx => tx.target);
        const dataArray = strategyTransactions.map(tx => tx.data);

        try {
          // Execute the batch through vault's execute function
          const result = await vaultContract.execute(targets, dataArray);
          await result.wait();
        } catch (error) {
          console.error("Failed to execute strategy transactions:", error);
          showError(`Failed to update strategy parameters: ${error.message}`);
          // Don't rethrow, let's update the UI state anyway
        }
      }

      // Update Redux with new strategy state
      dispatch(updateVaultStrategy({
        vaultAddress,
        strategy: {
          strategyId: selectedStrategy,
          strategyAddress,
          parameters: strategyParams,
          selectedTokens,
          selectedPlatforms,
          isActive: automationEnabled,
          lastUpdated: Date.now()
        }
      }));

      // Trigger a data refresh
      dispatch(triggerUpdate());

      // Show success message
      showSuccess("Strategy configuration saved successfully");

      // Update component state
      setInitialAutomationState(automationEnabled);
      setInitialSelectedStrategy(selectedStrategy);
      setHasUnsavedChanges(false);
      setEditMode(false);
    } catch (error) {
      console.error("Error saving strategy configuration:", error);
      showError(`Failed to save strategy: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
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
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default StrategyConfigPanel;
