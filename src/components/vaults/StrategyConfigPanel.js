// src/components/vaults/StrategyConfigPanel.js
import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useSelector, useDispatch } from 'react-redux';
import { Card, Form, Button, Alert, Spinner, Badge } from 'react-bootstrap';
import { getVaultContract, executeVaultTransactions } from '../../utils/contracts';
import contractData from '../../abis/contracts.json';
import { getAvailableStrategies, getStrategyParameters, getTemplateDefaults } from '../../utils/strategyConfig';
import StrategyDetailsSection from './StrategyDetailsSection';
import { updateVaultStrategy, updateVault } from '../../redux/vaultsSlice';
import { triggerUpdate } from '../../redux/updateSlice';
import { useToast } from '@/context/ToastContext';
import StrategyDeactivationModal from './StrategyDeactivationModal';
import StrategyTransactionModal from './StrategyTransactionModal';
import { config } from 'dotenv';

const StrategyConfigPanel = ({
  vaultAddress,
  isOwner,
  strategyActive,
  performance,
  onStrategyToggle
}) => {
  const dispatch = useDispatch();
  const provider = useSelector(state => state.wallet.provider);
  const chainId = useSelector(state => state.wallet.chainId);
  const availableStrategies = useSelector(state => state.strategies.availableStrategies);

  // Get the vault from Redux
  const vault = useSelector((state) =>
    state.vaults.userVaults.find(v => v.address === vaultAddress)
  );

  // State
  const [selectedStrategy, setSelectedStrategy] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [automationEnabled, setAutomationEnabled] = useState(false);
  const [activePreset, setActivePreset] = useState('custom');
  const [strategyParams, setStrategyParams] = useState({});
  // Store complete set of parameters including template defaults
  const [initialParams, setInitialParams] = useState({});
  const [selectedTokens, setSelectedTokens] = useState([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [validateFn, setValidateFn] = useState(null);

  // Modals state
  const [showDeactivationModal, setShowDeactivationModal] = useState(false);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [transactionSteps, setTransactionSteps] = useState([]);
  const [currentTransactionStep, setCurrentTransactionStep] = useState(0);
  const [transactionError, setTransactionError] = useState('');
  const [transactionLoading, setTransactionLoading] = useState(false);

  // Change tracking
  const [initialAutomationState, setInitialAutomationState] = useState(false);
  const [initialSelectedStrategy, setInitialSelectedStrategy] = useState('');
  const [initialActivePreset, setInitialActivePreset] = useState('custom');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [templateChanged, setTemplateChanged] = useState(false);
  const [tokensChanged, setTokensChanged] = useState(false);
  const [platformsChanged, setPlatformsChanged] = useState(false);
  const [paramsChanged, setParamsChanged] = useState(false);
  const { showSuccess, showError } = useToast();

  // Load available strategies and set initial state on component mount
  useEffect(() => {
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

      // Store parameters and preset
      if (vault.strategy.parameters) {
        setStrategyParams(vault.strategy.parameters);
        setInitialParams(vault.strategy.parameters);
      }

      // Set preset
      if (vault.strategy.activeTemplate) {
        setActivePreset(vault.strategy.activeTemplate);
        setInitialActivePreset(vault.strategy.activeTemplate);
      }

      // Set selected tokens and platforms
      if (vault.strategy.selectedTokens) {
        setSelectedTokens(vault.strategy.selectedTokens);
      }

      if (vault.strategy.selectedPlatforms) {
        setSelectedPlatforms(vault.strategy.selectedPlatforms);
      }
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
      (automationEnabled && selectedStrategy !== initialSelectedStrategy) ||
      activePreset !== initialActivePreset ||
      templateChanged || tokensChanged || platformsChanged || paramsChanged;

    setHasUnsavedChanges(hasChanges);
  }, [
    automationEnabled,
    selectedStrategy,
    initialAutomationState,
    initialSelectedStrategy,
    activePreset,
    initialActivePreset,
    templateChanged,
    tokensChanged,
    platformsChanged,
    paramsChanged
  ]);

  // Handle strategy selection change
  const handleStrategyChange = (e) => {
    setSelectedStrategy(e.target.value);
    setEditMode(true);
  };

  // Handle automation toggle
  const handleAutomationToggle = (e) => {
    const isEnabled = e.target.checked;

    if (initialAutomationState && !isEnabled) {
      // Show deactivation confirmation modal when turning off an active strategy
      setShowDeactivationModal(true);
    } else {
      // Direct set for enabling (turning on) a strategy
      setAutomationEnabled(isEnabled);

      // If toggling off automation, clear the selected strategy
      if (!isEnabled) {
        setSelectedStrategy('');
        setEditMode(false);
      }
    }
  };

  // Handle confirmation of strategy deactivation
  const handleConfirmDeactivation = async () => {
    setShowDeactivationModal(false);

    try {
      // Set loading state
      setIsLoading(true);

      if (!provider) {
        throw new Error("No provider available");
      }

      // Get signer
      const signer = await provider.getSigner();

      // Get vault contract instance
      const vaultContract = getVaultContract(vaultAddress, provider, signer);

      // Send transaction to remove strategy
      const tx = await vaultContract.removeStrategy();

      // Wait for transaction to be mined
      await tx.wait();

      // Turn off automation
      setAutomationEnabled(false);
      setSelectedStrategy('');
      setEditMode(false);

      // Update vault data in Redux
      dispatch(updateVault({
        vaultAddress,
        vaultData: {
          hasActiveStrategy: false,
          strategyAddress: null
        }
      }));

      // Update strategy state in Redux
      dispatch(updateVaultStrategy({
        vaultAddress,
        strategy: {
          isActive: false,
          lastUpdated: Date.now()
        }
      }));

      // Trigger data refresh
      dispatch(triggerUpdate());

      // Show success message
      showSuccess("Strategy deactivated successfully");
    } catch (error) {
      console.error("Error deactivating strategy:", error);
      showError(`Failed to deactivate strategy: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle edit request from child component
  const handleEditRequest = () => {
    setEditMode(true);
  };

  // Check if parameters have changed compared to initial values
  const checkParametersChanged = (newParams, originalParams) => {
    // If we don't have original params, consider it changed
    if (!originalParams || Object.keys(originalParams).length === 0) {
      return Object.keys(newParams).length > 0;
    }

    // Check for any differences
    for (const [key, value] of Object.entries(newParams)) {
      // If parameter doesn't exist in original or value is different
      if (originalParams[key] === undefined || originalParams[key] !== value) {
        return true;
      }
    }

    // Check for keys in original that are no longer in newParams
    for (const key of Object.keys(originalParams)) {
      if (newParams[key] === undefined) {
        return true;
      }
    }

    return false;
  };

  // Handle parameter changes
  const handleParamsChange = (paramData) => {
    if (paramData.activePreset !== activePreset) {
      setTemplateChanged(true)
      const newPreset = paramData.activePreset;
      setActivePreset(newPreset);

      // If switching to a preset (not custom), load template parameters
      if (newPreset !== 'custom') {
        const templateDefaults = getTemplateDefaults(selectedStrategy, newPreset);
        if (templateDefaults) {
          setStrategyParams(templateDefaults);
          // Also update initialParams when changing templates
          setInitialParams(templateDefaults);
          setParamsChanged(false);
        }
      }
    }

    if (paramData.parameters !== strategyParams) {
      const newParams = { ...strategyParams, ...paramData.parameters };

      // Update strategy parameters
      setStrategyParams(newParams);

      // Check if parameters have changed from initial values
      const changed = checkParametersChanged(newParams, initialParams);
      setParamsChanged(changed);
    }

    // Store token and platform selections too
    if (paramData.selectedTokens !== selectedTokens) {
      setTokensChanged(true);
      setSelectedTokens(paramData.selectedTokens);
    }

    if (paramData.selectedPlatforms !== selectedPlatforms) {
      setPlatformsChanged(true);
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

  // Get the strategy name for display
  const getStrategyName = () => {
    const strategy = availableStrategies.find(s => s.id === selectedStrategy);
    return strategy?.name || "Strategy";
  };

  // Generate transaction steps based on what needs to be done
  const generateTransactionSteps = () => {
    const steps = [];
    const strategyConfig = availableStrategies.find(s => s.id === selectedStrategy);
    const strategyName = strategyConfig?.name || "Strategy";

    // Step 1: Set strategy if activating or changing
    if (!vault.strategyAddress || initialSelectedStrategy !== selectedStrategy) {
      steps.push({
        title: `Set Strategy Contract`,
        description: `Authorize the ${strategyName} strategy for this vault`,
      });
    }

    // Step 2: Set target tokens if provided
    if (selectedTokens.length > 0 && tokensChanged) {
      steps.push({
        title: `Set Target Tokens`,
        description: `Configure which tokens the strategy will manage`,
      });
    }

    // Step 3: Set target platforms if provided
    if (selectedPlatforms.length > 0 && platformsChanged) {
      steps.push({
        title: `Set Target Platforms`,
        description: `Configure which platforms the strategy will use`,
      });
    }

    // Step 4: Select template if applicable
    if (activePreset && templateChanged) {
      steps.push({
        title: `Select Strategy Template`,
        description: `Apply the ${activePreset} template to set initial parameters`,
      });
    }

    // Step 5: Set parameters if changed
    if ((activePreset === 'custom' || paramsChanged) && Object.keys(strategyParams).length > 0) {
      steps.push({
        title: `Set Strategy Parameters`,
        description: `Configure the detailed behavior of the strategy`,
      });
    }

    return steps;
  };

  // Handle save button click
  const handleSave = async () => {
    // Validation
    if (typeof validateFn === 'function') {
      const isValid = validateFn();
      if (!isValid) return;
    }

    // Generate transaction steps
    const steps = generateTransactionSteps();
    setTransactionSteps(steps);
    setCurrentTransactionStep(0);
    setTransactionError('');
    setShowTransactionModal(true);

    try {
      setTransactionLoading(true);

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
      let strategyAddress;
      Object.keys(contractData).forEach(contractKey => {
        // Skip non-strategy contracts
        if (['VaultFactory', 'PositionVault', 'BatchExecutor', 'ParrisIslandStrategy'].includes(contractKey)) {
          return;
        }

        const addresses = contractData[contractKey].addresses || {};
        if (addresses[chainId]) {
          strategyAddress = addresses[chainId];
        }
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
      let isAuthorized = false;
      try {
        isAuthorized = await strategyContract.authorizedVaults(vaultAddress);
      } catch (authCheckError) {
        console.warn("Strategy doesn't support vault authorization check:", authCheckError.message);
      }

      if (!isAuthorized) {
        try {
          // If not authorized, try to authorize it
          const authTx = await strategyContract.authorizeVault(vaultAddress);
          await authTx.wait();
        } catch (authError) {
          console.warn("Strategy doesn't support vault authorization or failed:", authError.message);
        }
      }

      // PART 1: Direct calls to PositionVault contract

      // Step 1: Set strategy if needed
      if (!vault.strategyAddress || !vault.hasActiveStrategy) {
        setCurrentTransactionStep(0);
        const setStrategyTx = await vaultContract.setStrategy(strategyAddress);
        await setStrategyTx.wait();
        setCurrentTransactionStep(1);
      }

      // Step 2: Set target tokens if needed
      if (automationEnabled && selectedStrategy && selectedTokens.length > 0 && tokensChanged) {
        // Find the correct step index
        const stepIndex = steps.findIndex(step => step.title.includes('Target Tokens'));
        if (stepIndex >= 0) setCurrentTransactionStep(stepIndex);

        // Create a NEW array for tokens to avoid immutability issues
        const setTokensTx = await vaultContract.setTargetTokens([...selectedTokens]);
        await setTokensTx.wait();
        setCurrentTransactionStep(stepIndex + 1);
      }

      // Step 3: Set target platforms if needed
      if (automationEnabled && selectedStrategy && selectedPlatforms.length > 0 && platformsChanged) {
        // Find the correct step index
        const stepIndex = steps.findIndex(step => step.title.includes('Target Platforms'));
        if (stepIndex >= 0) setCurrentTransactionStep(stepIndex);

        // Create a NEW array for platforms to avoid immutability issues
        const setPlatformsTx = await vaultContract.setTargetPlatforms([...selectedPlatforms]);
        await setPlatformsTx.wait();
        setCurrentTransactionStep(stepIndex + 1);
      }

      // PART 2: Batch calls to Strategy contract through vault's execute function

      // Array to hold strategy transactions
      const strategyTransactions = [];

      // Get strategy-specific configuration for formatting parameters
      const parameterDefinitions = getStrategyParameters(selectedStrategy);

      // Step 4: Handle template selection if the strategy supports templates
      if (automationEnabled && selectedStrategy && activePreset && templateChanged) {
        // Find the correct step index
        const stepIndex = steps.findIndex(step => step.title.includes('Template'));
        if (stepIndex >= 0) setCurrentTransactionStep(stepIndex);

        // Get the template enum mapping from the config if available
        const templateEnumMap = strategyConfig.templateEnumMap;
        let templateValue = 0; // Default to 0 for 'custom'

        if (activePreset !== 'custom') {
          templateValue = templateEnumMap ? templateEnumMap[activePreset] || 0 : 0;
        }

        strategyTransactions.push({
          target: strategyAddress,
          data: strategyContract.interface.encodeFunctionData("selectTemplate", [
            templateValue
          ]),
          description: `Select template: ${activePreset} (value: ${templateValue})`
        });
      }

      // Step 5: Set strategy parameters based on the strategy's parameter groups
      if (automationEnabled && selectedStrategy && (activePreset === 'custom' || paramsChanged)) {
        // Get contract parameter groups from config
        const contractParamGroups = strategyConfig.contractParametersGroups || [];

        // Process each contract parameter group
        for (const group of contractParamGroups) {
          // Get parameters for this contract group
          const groupParamIds = group.parameters || [];
          const availableParams = groupParamIds.filter(paramId => strategyParams[paramId] !== undefined);

          // Skip if no parameters in this group or not all required parameters are available
          if (availableParams.length === 0 || availableParams.length !== groupParamIds.length) continue;

          // Format parameters according to their types
          const formattedParams = groupParamIds.map(paramId => {
            const value = strategyParams[paramId];
            const config = parameterDefinitions[paramId];

            // Format based on parameter type
            switch (config.type) {
              case 'percent':
                // Convert percentage to basis points (multiply by 100)
                return Math.round(parseFloat(value) * 100);

              case 'fiat-currency':
                // Convert to pennies
                return parseFloat(value).toFixed(2) * 100;

              case 'boolean':
                return !!value;

              case 'select':
                // Use the raw value for select types (should be enum value)
                return parseInt(value);

              default:
                // For other types, use the value as is
                return value;
            }
          });

          // Create transaction for this parameter group
          strategyTransactions.push({
            target: strategyAddress,
            data: strategyContract.interface.encodeFunctionData(group.setterMethod, formattedParams),
            description: `Set ${group.id} parameters`
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

          // Set step to completed
          setCurrentTransactionStep(steps.length);
        } catch (error) {
          console.error("Failed to execute strategy transactions:", error);
          setTransactionError(`Failed to update strategy parameters: ${error.message}`);
          throw error;
        }
      } else {
        // If no strategy transactions, mark as complete
        setCurrentTransactionStep(steps.length);
      }

      // Update Redux with new strategy state - including proper vault fields
      dispatch(updateVaultStrategy({
        vaultAddress,
        strategy: {
          strategyId: selectedStrategy,
          strategyAddress,
          parameters: strategyParams,
          selectedTokens,
          selectedPlatforms,
          isActive: automationEnabled,
          activeTemplate: activePreset,
          lastUpdated: Date.now()
        }
      }));

      // Update the top-level vault fields too - THIS IS CRITICAL FOR DISPLAY UPDATES
      dispatch(updateVault({
        vaultAddress,
        vaultData: {
          hasActiveStrategy: automationEnabled,
          strategyAddress: automationEnabled ? strategyAddress : null
        }
      }));

      // Trigger a data refresh
      dispatch(triggerUpdate());

      // Show success message
      showSuccess("Strategy configuration saved successfully");

      // Update component state
      setInitialAutomationState(automationEnabled);
      setInitialSelectedStrategy(selectedStrategy);
      setInitialActivePreset(activePreset);
      setInitialParams(strategyParams);
      setTemplateChanged(false);
      setTokensChanged(false);
      setPlatformsChanged(false);
      setParamsChanged(false);
      setHasUnsavedChanges(false);
      setEditMode(false);

      // Keep transaction modal open to show completion
      setTransactionLoading(false);
    } catch (error) {
      console.error("Error saving strategy configuration:", error);
      setTransactionError(`Failed to save strategy: ${error.message}`);
      showError(`Failed to save strategy: ${error.message}`);
      setTransactionLoading(false);
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

    if (activePreset !== initialActivePreset) {
      setActivePreset(initialActivePreset);
    }

    // Reset parameters to initial state
    setStrategyParams(initialParams);
    setTemplateChanged(false);
    setTokensChanged(false);
    setPlatformsChanged(false);
    setParamsChanged(false);

    setHasUnsavedChanges(false);
    setEditMode(false);
  };

  // Close transaction modal
  const handleCloseTransactionModal = () => {
    setShowTransactionModal(false);
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

      {/* Strategy Deactivation Modal */}
      <StrategyDeactivationModal
        show={showDeactivationModal}
        onHide={() => setShowDeactivationModal(false)}
        onConfirm={handleConfirmDeactivation}
        strategyName={getStrategyName()}
      />

      {/* Strategy Transaction Modal */}
      <StrategyTransactionModal
        show={showTransactionModal}
        onHide={handleCloseTransactionModal}
        onCancel={() => {
          if (!transactionLoading) {
            setShowTransactionModal(false);
          }
        }}
        currentStep={currentTransactionStep}
        steps={transactionSteps}
        isLoading={transactionLoading}
        error={transactionError}
        tokenSymbols={selectedTokens}
        strategyName={getStrategyName()}
      />
    </Card>
  );
};

export default StrategyConfigPanel;
