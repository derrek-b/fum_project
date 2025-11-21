// src/components/vaults/StrategyConfigPanel.js
import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useSelector, useDispatch } from 'react-redux';
import { Card, Form, Button, Alert, Spinner, Badge } from 'react-bootstrap';
import StrategyDetailsSection from './StrategyDetailsSection';
import { updateVaultStrategy, updateVault } from '../../redux/vaultsSlice';
import { triggerUpdate } from '../../redux/updateSlice';
import { useToast } from '@/context/ToastContext';
import { useProvider } from '../../contexts/ProviderContext';
import StrategyDeactivationModal from './StrategyDeactivationModal';
import TransactionProgressModal from '../common/TransactionProgressModal';
import StrategyValidationModal from './StrategyValidationModal';
import { getVaultContract, executeVaultTransactions } from 'fum_library/blockchain/contracts';
import contractData from 'fum_library/artifacts/contracts';
import { lookupAvailableStrategies, getStrategyParameters, getTemplateDefaults, validateTokensForStrategy, validatePositionsForStrategy } from 'fum_library/helpers/strategyHelpers';
import { getExecutorAddress } from 'fum_library/helpers/chainHelpers';
import { config } from 'dotenv';

const StrategyConfigPanel = ({
  vaultAddress,
  isOwner,
  performance,
  onStrategyToggle
}) => {
  const dispatch = useDispatch();
  const { provider } = useProvider();
  const chainId = useSelector(state => state.wallet.chainId);
  const availableStrategies = useSelector(state => state.strategies.availableStrategies);

  // Get the vault from Redux
  const vault = useSelector((state) =>
    state.vaults.userVaults.find(v => v.address === vaultAddress)
  );

  // Get positions and pools from Redux for validation
  const allPositions = useSelector((state) => state.positions.positions);
  const pools = useSelector((state) => state.pools);

  // State
  const [selectedStrategy, setSelectedStrategy] = useState('');
  const [isLoading, setIsLoading] = useState(false);
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
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [validationWarnings, setValidationWarnings] = useState([]);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [transactionSteps, setTransactionSteps] = useState([]);
  const [currentTransactionStep, setCurrentTransactionStep] = useState(0);
  const [transactionError, setTransactionError] = useState('');
  const [transactionWarning, setTransactionWarning] = useState('');
  const [transactionLoading, setTransactionLoading] = useState(false);

  // Change tracking
  const [initialSelectedStrategy, setInitialSelectedStrategy] = useState('');
  const [initialActivePreset, setInitialActivePreset] = useState('custom');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [templateChanged, setTemplateChanged] = useState(false);
  const [tokensChanged, setTokensChanged] = useState(false);
  const [platformsChanged, setPlatformsChanged] = useState(false);
  const [paramsChanged, setParamsChanged] = useState(false);
  const [currentPresetDefaults, setCurrentPresetDefaults] = useState({});

  // NEW: Add data loading state
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  const { showSuccess, showError } = useToast();

  // Load available strategies and set initial state on component mount
  useEffect(() => {
    // Reset change tracking flags during loading
    setTemplateChanged(false);
    setTokensChanged(false);
    setPlatformsChanged(false);
    setParamsChanged(false);
    setHasUnsavedChanges(false);

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

        // If we're using a preset (not custom), load its defaults as baseline
        if (vault.strategy.activeTemplate !== 'custom') {
          const presetDefaults = getTemplateDefaults(activeStrategy, vault.strategy.activeTemplate);
          if (presetDefaults) {
            setCurrentPresetDefaults(presetDefaults);
          }
        } else {
          setCurrentPresetDefaults({});
        }
      } else {
        setCurrentPresetDefaults({});
      }

      // Set selected tokens and platforms
      if (vault.strategy.selectedTokens) {
        setSelectedTokens(vault.strategy.selectedTokens);
      }

      if (vault.strategy.selectedPlatforms) {
        setSelectedPlatforms(vault.strategy.selectedPlatforms);
      }
    } else if (vault?.hasActiveStrategy) {
      // Fallback to 'fed' if we know there's a strategy but don't have details
      setSelectedStrategy('fed');
      setInitialSelectedStrategy('fed');
      setCurrentPresetDefaults({});
    } else {
      setSelectedStrategy('');
      setInitialSelectedStrategy('');
      setCurrentPresetDefaults({});
    }

    // Determine if data is fully loaded
    const isComplete = vault && (
      !vault.hasActiveStrategy ||
      (vault.strategy?.strategyId && vault.strategy?.parameters)
    );

    if (isComplete) {
      setIsDataLoaded(true)
    } else {
      setIsDataLoaded(false);
    }
  }, [vault]);

  // Check for unsaved changes whenever relevant state changes
  useEffect(() => {
    // Only detect changes after data is fully loaded
    if (!isDataLoaded) return;

    const hasChanges =
      // Strategy selection changes
      (selectedStrategy !== initialSelectedStrategy) ||
      (activePreset !== initialActivePreset) ||
      templateChanged || tokensChanged || platformsChanged || paramsChanged;

    setHasUnsavedChanges(hasChanges);
  }, [
    isDataLoaded, // Add this to prevent premature detection
    selectedStrategy,
    initialSelectedStrategy, // Add initial values to dependencies
    activePreset,
    initialActivePreset,
    templateChanged,
    tokensChanged,
    platformsChanged,
    paramsChanged
  ]);

  // Handle strategy selection change
  const handleStrategyChange = (e) => {
    if (!isDataLoaded) return; // Prevent changes during loading
    setSelectedStrategy(e.target.value);
    setEditMode(true);
  };

  // Handle confirmation of strategy deactivation
  const handleConfirmDeactivation = async () => {
    const hasExecutor = vault.executor !== '0x0000000000000000000000000000000000000000';

    // Path A: Has executor (2 transactions) - use progress modal
    if (hasExecutor) {
      try {
        setTransactionLoading(true);

        if (!provider) {
          throw new Error("No provider available");
        }

        // Get signer
        const signer = await provider.getSigner();

        // Get vault contract instance with signer
        const vaultContract = getVaultContract(vaultAddress, provider).connect(signer);

        // Generate deactivation steps and show modal
        const steps = generateDeactivationSteps(true);
        setTransactionSteps(steps);
        setCurrentTransactionStep(0);
        setTransactionError('');
        setTransactionWarning('');
        setShowTransactionModal(true);

        // TX 1: Remove executor
        try {
          setCurrentTransactionStep(0);
          const removeExecutorTx = await vaultContract.removeExecutor();
          await removeExecutorTx.wait();

          // Update vault data in Redux
          dispatch(updateVault({
            vaultAddress,
            vaultData: {
              executor: '0x0000000000000000000000000000000000000000'
            }
          }));

          setCurrentTransactionStep(1);
        } catch (error) {
          setTransactionLoading(false);

          // Check if user cancelled
          if (error.code === 'ACTION_REJECTED' || error.code === 4001 || error.message?.includes('user rejected')) {
            setTransactionWarning('Transaction cancelled. Strategy deactivation aborted.');
            return;
          }

          // Real error - set specific message and throw
          const errorMessage = error.reason || error.message || "Unknown error";
          setTransactionError(`Failed to remove executor: ${errorMessage}`);
          throw error;
        }

        // TX 2: Remove strategy
        try {
          setCurrentTransactionStep(1);
          const removeStrategyTx = await vaultContract.removeStrategy();
          await removeStrategyTx.wait();
          setCurrentTransactionStep(2);
        } catch (error) {
          setTransactionLoading(false);

          // Check if user cancelled
          if (error.code === 'ACTION_REJECTED' || error.code === 4001 || error.message?.includes('user rejected')) {
            setTransactionWarning('Executor removed but strategy deactivation cancelled. Strategy is still active. Please manually deactivate the strategy to complete the process.');
            return;
          }

          // Real error - set specific message and throw
          const errorMessage = error.reason || error.message || "Unknown error";
          setTransactionError(`Failed to remove strategy: ${errorMessage}`);
          throw error;
        }

        // Success - clear strategy state
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
        setShowTransactionModal(false);
        setShowDeactivationModal(false);
        setTransactionLoading(false);
      } catch (error) {
        // Always set loading to false
        setTransactionLoading(false);

        // Check if user cancelled (shouldn't reach here but defensive)
        if (error.code === 'ACTION_REJECTED' || error.code === 4001 || error.message?.includes('user rejected')) {
          setTransactionWarning('Strategy deactivation cancelled.');
          return;
        }

        // Real error - only set if not already set by nested catches
        if (!transactionError) {
          const errorMessage = error.reason || error.message || "Unknown error";
          console.error("Strategy deactivation failed:", errorMessage);
          setTransactionError(`Failed to deactivate strategy: ${errorMessage}`);
        }
        // Modal stays open to show which step failed
      }
    } else {
      // Path B: No executor (1 transaction) - simple toast-based flow
      try {
        setIsLoading(true);

        if (!provider) {
          throw new Error("No provider available");
        }

        // Get signer
        const signer = await provider.getSigner();

        // Get vault contract instance with signer
        const vaultContract = getVaultContract(vaultAddress, provider).connect(signer);

        // Remove strategy
        const removeStrategyTx = await vaultContract.removeStrategy();
        await removeStrategyTx.wait();

        // Clear strategy state
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
        setShowDeactivationModal(false);
      } catch (error) {
        // Check if user cancelled
        if (error.code === 'ACTION_REJECTED' || error.code === 4001 || error.message?.includes('user rejected')) {
          // User cancelled - keep modal open so they know it didn't complete
          return;
        }

        // Real error - show toast with specific message
        const errorMessage = error.reason || error.message || "Unknown error";
        console.error("Error deactivating strategy:", errorMessage);
        showError(`Failed to deactivate strategy: ${errorMessage}`);
      } finally {
        setIsLoading(false);
      }
    }
  };

  // Handle edit request from child component
  const handleEditRequest = () => {
    if (!isDataLoaded) return; // Prevent changes during loading
    setEditMode(true);
  };

  // Check if parameters have changed compared to initial values - uses deep comparison
  const checkParametersChanged = (newParams, originalParams) => {
    if (!originalParams) {
      return Object.keys(newParams).length > 0;
    }

    const keys = new Set([...Object.keys(newParams), ...Object.keys(originalParams)]);

    for (const key of keys) {
      const newValue = newParams[key];
      const originalValue = originalParams[key];

      if (newValue === undefined || originalValue === undefined) {
        if (newValue !== originalValue) {
          return true;
        }
      } else if (typeof newValue === 'object' && typeof originalValue === 'object') {
        if (JSON.stringify(newValue) !== JSON.stringify(originalValue)) {
          return true;
        }
      } else if (newValue !== originalValue) {
        return true;
      }
    }

    return false;
  };

  // Helper to compare arrays regardless of order
  const areArraysEqual = (arr1, arr2) => {
    if (!arr1 || !arr2) return false;
    if (arr1.length !== arr2.length) return false;

    // Create sorted copies for comparison
    const sorted1 = [...arr1].sort();
    const sorted2 = [...arr2].sort();

    return sorted1.every((val, idx) => val === sorted2[idx]);
  };

  // Handle parameter changes
  const handleParamsChange = (paramData) => {
    if (!isDataLoaded) return; // Prevent changes during loading

    // Handle preset change
    if (paramData.activePreset !== activePreset) {
      setTemplateChanged(paramData.activePreset !== initialActivePreset);
      const newPreset = paramData.activePreset;
      setActivePreset(newPreset);

      // If switching to a preset (not custom), load template parameters
      if (newPreset !== 'custom') {
        const templateDefaults = getTemplateDefaults(selectedStrategy, newPreset);
        if (templateDefaults) {
          setStrategyParams(templateDefaults);
          // Store the preset defaults as the new baseline for detecting custom modifications
          setCurrentPresetDefaults(templateDefaults);
          // When switching to a preset, there are no custom modifications yet
          setParamsChanged(false);
        }
      } else {
        // When switching to custom, clear the preset defaults baseline
        setCurrentPresetDefaults({});
      }
    }

    // Handle parameter changes with deep comparison
    if (paramData.parameters) {
      const newParams = { ...strategyParams, ...paramData.parameters };
      setStrategyParams(newParams);

      // Check if parameters have changed from the current preset defaults (if using a preset)
      // or from the initial vault state (if using custom or no preset)
      const baseline = (activePreset && activePreset !== 'custom' && Object.keys(currentPresetDefaults).length > 0)
        ? currentPresetDefaults
        : initialParams;

      const hasChanged = checkParametersChanged(newParams, baseline);
      setParamsChanged(hasChanged);
    }

    // Handle token selection with proper array comparison
    if (paramData.selectedTokens) {
      setSelectedTokens(paramData.selectedTokens);
      // Check if tokens have changed using array comparison
      setTokensChanged(!areArraysEqual(paramData.selectedTokens, currentStrategy?.selectedTokens || []));
    }

    // Handle platform selection with proper array comparison
    if (paramData.selectedPlatforms) {
      setSelectedPlatforms(paramData.selectedPlatforms);
      // Check if platforms have changed using array comparison
      setPlatformsChanged(!areArraysEqual(paramData.selectedPlatforms, currentStrategy?.selectedPlatforms || []));
    }
  };

  // Set validation function - memoized to prevent infinite loops
  const handleSetValidation = useCallback((_validateFn) => {
    setValidateFn(() => _validateFn);
  }, []);

  // Get the strategy name for display
  const getStrategyName = () => {
    const strategy = availableStrategies.find(s => s.id === selectedStrategy);
    return strategy?.name || "Strategy";
  };

  // Generate transaction steps based on what needs to be done
  const generateTransactionSteps = (needsAuthorization = false) => {
    const steps = [];
    const strategyConfig = availableStrategies.find(s => s.id === selectedStrategy);
    const strategyName = strategyConfig?.name || "Strategy";

    // Step 0: Authorize vault in strategy contract if needed
    if (needsAuthorization) {
      steps.push({
        title: `Authorize Vault`,
        description: `Register this vault with the ${strategyName} strategy contract`,
      });
    }

    // Step 1: Set strategy if activating or changing
    if (!vault.strategyAddress || initialSelectedStrategy !== selectedStrategy) {
      steps.push({
        title: `Set Strategy Contract`,
        description: `Configure the vault to use the ${strategyName} strategy`,
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

    // Step 4: Template & parameters (executed as single batched transaction)
    const shouldShowParamStep = (activePreset && templateChanged) ||
      ((activePreset === 'custom' || paramsChanged) && Object.keys(strategyParams).length > 0);

    if (shouldShowParamStep) {
      let description = `Configure the strategy parameters (preset: ${activePreset || 'none'})`;

      // Add note about customizations if using preset with modifications
      if (activePreset && activePreset !== 'custom' && paramsChanged) {
        description += ' with custom modifications';
      }

      steps.push({
        title: `Set Strategy Template & Parameters`,
        description: description,
      });
    }

    return steps;
  };

  // Generate deactivation steps based on whether executor needs to be removed
  const generateDeactivationSteps = (hasExecutor) => {
    const steps = [];

    // Step 1: Remove executor if it exists
    if (hasExecutor) {
      steps.push({
        title: 'Remove Executor',
        description: 'Disable automation for this vault',
      });
    }

    // Step 2: Remove strategy (always)
    steps.push({
      title: 'Remove Strategy',
      description: 'Deactivate strategy contract',
    });

    return steps;
  };

  // Handle save button click
  const handleSave = async () => {
    // Validation
    if (typeof validateFn === 'function') {
      const isValid = validateFn();
      if (!isValid) return;
    }

    // Check for token mismatches and show validation modal if needed
    const warnings = [];

    // Check token balances
    if (selectedTokens.length > 0 && vault?.tokenBalances && Object.keys(vault.tokenBalances).length > 0) {
      const tokenValidation = validateTokensForStrategy(vault.tokenBalances, selectedTokens);
      if (!tokenValidation.isValid) {
        warnings.push(...tokenValidation.warnings);
      }
    }

    // Check vault positions
    if (selectedTokens.length > 0 && vault?.positions && vault.positions.length > 0) {
      // Get full position objects from position IDs
      const vaultPositions = vault.positions
        .map(id => allPositions.find(p => p.id === id))
        .filter(Boolean); // Remove any undefined positions

      const positionValidation = validatePositionsForStrategy(vaultPositions, pools, selectedTokens);
      if (!positionValidation.isValid) {
        warnings.push(...positionValidation.warnings);
      }
    }

    // If there are warnings, show validation modal first
    if (warnings.length > 0) {
      setValidationWarnings(warnings);
      setShowValidationModal(true);
      return;
    }

    // Otherwise proceed directly to save
    await proceedWithSave();
  };

  // Actual save logic (called after validation modal confirmation or directly)
  const proceedWithSave = async () => {
    try {
      setTransactionLoading(true);

      if (!provider) {
        throw new Error("No provider available");
      }

      // Get signer with await
      const signer = await provider.getSigner();

      // Get the selected strategy details from Redux store (has contractKey)
      const strategyConfig = availableStrategies.find(s => s.id === selectedStrategy);
      if (!strategyConfig) {
        throw new Error(`Strategy configuration not found for ${selectedStrategy}`);
      }

      // Get the contract key and address for the selected strategy
      const contractKey = strategyConfig.contractKey;
      const strategyAddress = contractData[contractKey]?.addresses?.[chainId];

      if (!strategyAddress) {
        throw new Error(`Strategy ${selectedStrategy} not deployed on this network (Chain ID: ${chainId})`);
      }

      // Get PositionVault contract instance with signer
      const vaultContract = getVaultContract(vaultAddress, provider).connect(signer);

      // Get strategy contract interface from config using correct contract key
      const strategyContract = new ethers.Contract(
        strategyAddress,
        contractData[contractKey].abi,
        signer
      );

      // Check if the vault is authorized in the strategy contract
      let isAuthorized = false;
      try {
        isAuthorized = await strategyContract.authorizedVaults(vaultAddress);
      } catch (authCheckError) {
        console.warn("Strategy doesn't support vault authorization check:", authCheckError.message);
      }

      // Generate transaction steps now that we know if authorization is needed
      const steps = generateTransactionSteps(!isAuthorized);
      setTransactionSteps(steps);
      setCurrentTransactionStep(0);
      setTransactionError('');
      setTransactionWarning('');
      setShowTransactionModal(true);

      // Execute authorization if needed
      if (!isAuthorized) {
        try {
          // If not authorized, try to authorize it
          setCurrentTransactionStep(0);
          const authTx = await strategyContract.authorizeVault(vaultAddress);
          await authTx.wait();
          setCurrentTransactionStep(1);
        } catch (authError) {
          // Always stop loading first
          setTransactionLoading(false);

          // Check if user cancelled the transaction
          if (authError.code === 'ACTION_REJECTED' || authError.code === 4001 || authError.message?.includes('user rejected')) {
            // User cancelled - set warning and keep modal open
            setTransactionWarning('Transaction cancelled. Strategy configuration incomplete. Automation cannot be enabled until all configuration steps are completed.');
            return;
          }

          // Real error - set error message and throw to abort the entire process
          const errorMessage = authError.reason || authError.message || "Unknown error";
          setTransactionError(`Failed to authorize vault in strategy contract: ${errorMessage}`);
          throw authError;
        }
      }

      // PART 1: Direct calls to PositionVault contract

      // Step: Set strategy if needed
      if (!vault.strategyAddress || !vault.hasActiveStrategy) {
        try {
          // Find the correct step index
          const stepIndex = steps.findIndex(step => step.title.includes('Set Strategy Contract'));
          if (stepIndex >= 0) setCurrentTransactionStep(stepIndex);

          const setStrategyTx = await vaultContract.setStrategy(strategyAddress);
          await setStrategyTx.wait();
          setCurrentTransactionStep(stepIndex + 1);
        } catch (error) {
          setTransactionLoading(false);

          // Check if user cancelled
          if (error.code === 'ACTION_REJECTED' || error.code === 4001 || error.message?.includes('user rejected')) {
            setTransactionWarning('Transaction cancelled. Strategy configuration incomplete. Automation cannot be enabled until all configuration steps are completed.');
            return;
          }

          // Real error - set specific message and throw
          const errorMessage = error.reason || error.message || "Unknown error";
          setTransactionError(`Failed to set strategy contract: ${errorMessage}`);
          throw error;
        }
      }

      // Step: Set target tokens if needed
      if (selectedStrategy && selectedTokens.length > 0 && tokensChanged) {
        try {
          // Find the correct step index
          const stepIndex = steps.findIndex(step => step.title.includes('Target Tokens'));
          if (stepIndex >= 0) setCurrentTransactionStep(stepIndex);

          // Create a NEW array for tokens to avoid immutability issues
          const setTokensTx = await vaultContract.setTargetTokens([...selectedTokens]);
          await setTokensTx.wait();
          setCurrentTransactionStep(stepIndex + 1);
        } catch (error) {
          setTransactionLoading(false);

          // Check if user cancelled
          if (error.code === 'ACTION_REJECTED' || error.code === 4001 || error.message?.includes('user rejected')) {
            setTransactionWarning('Transaction cancelled. Strategy configuration incomplete. Automation cannot be enabled until all configuration steps are completed.');
            return;
          }

          // Real error - set specific message and throw
          const errorMessage = error.reason || error.message || "Unknown error";
          setTransactionError(`Failed to set target tokens: ${errorMessage}`);
          throw error;
        }
      }

      // Step: Set target platforms if needed
      if (selectedStrategy && selectedPlatforms.length > 0 && platformsChanged) {
        try {
          // Find the correct step index
          const stepIndex = steps.findIndex(step => step.title.includes('Target Platforms'));
          if (stepIndex >= 0) setCurrentTransactionStep(stepIndex);

          // Create a NEW array for platforms to avoid immutability issues
          const setPlatformsTx = await vaultContract.setTargetPlatforms([...selectedPlatforms]);
          await setPlatformsTx.wait();
          setCurrentTransactionStep(stepIndex + 1);
        } catch (error) {
          setTransactionLoading(false);

          // Check if user cancelled
          if (error.code === 'ACTION_REJECTED' || error.code === 4001 || error.message?.includes('user rejected')) {
            setTransactionWarning('Transaction cancelled. Strategy configuration incomplete. Automation cannot be enabled until all configuration steps are completed.');
            return;
          }

          // Real error - set specific message and throw
          const errorMessage = error.reason || error.message || "Unknown error";
          setTransactionError(`Failed to set target platforms: ${errorMessage}`);
          throw error;
        }
      }

      // PART 2: Batch calls to Strategy contract through vault's execute function

      // Array to hold strategy transactions
      const strategyTransactions = [];

      // Get strategy-specific configuration for formatting parameters
      const parameterDefinitions = getStrategyParameters(selectedStrategy);

      // Step 4: Handle template selection if the strategy supports templates
      if (selectedStrategy && activePreset && templateChanged) {
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
      if (selectedStrategy && (activePreset === 'custom' || paramsChanged)) {
        // Get contract parameter groups from config
        const contractParamGroups = strategyConfig.contractParametersGroups || [];

        // Process each contract parameter group
        for (const group of contractParamGroups) {
          // Get parameters for this contract group
          const groupParamIds = group.parameters || [];
          const availableParams = groupParamIds.filter(paramId => strategyParams[paramId] !== undefined);

          // Skip if no parameters in this group or not all required parameters are available
          if (availableParams.length === 0 || availableParams.length !== groupParamIds.length) {
            continue;
          }

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
                // Convert to pennies/cents (ensure integer, not float)
                return Math.round(parseFloat(value) * 100);

              case 'integer':
                // Integer values (counts, days, etc.)
                return parseInt(value);

              case 'decimal':
                // Decimal values (ratios, multipliers, etc.)
                return parseFloat(value);

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
          // Always stop loading first
          setTransactionLoading(false);

          // Check if user cancelled the transaction
          if (error.code === 'ACTION_REJECTED' || error.code === 4001 || error.message?.includes('user rejected')) {
            // User cancelled - set warning and keep modal open
            setTransactionWarning('Transaction cancelled. Strategy configuration incomplete. Automation cannot be enabled until all configuration steps are completed.');
            return;
          }

          // Real error - parse meaningful message, keep modal open, and throw to main catch
          const errorMessage = error.reason || error.message || "Unknown error";
          console.error("Failed to execute strategy transactions:", errorMessage);
          setTransactionError(`Failed to update strategy parameters: ${errorMessage}`);
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
          isActive: true,
          activeTemplate: activePreset,
          lastUpdated: Date.now()
        }
      }));

      // Update the top-level vault fields too - THIS IS CRITICAL FOR DISPLAY UPDATES
      dispatch(updateVault({
        vaultAddress,
        vaultData: {
          hasActiveStrategy: true,
          strategyAddress: strategyAddress
        }
      }));

      // Trigger a data refresh
      dispatch(triggerUpdate());

      // Show success message
      showSuccess("Strategy configuration saved successfully");

      // Update component state
      setInitialSelectedStrategy(selectedStrategy);
      setInitialActivePreset(activePreset);
      setInitialParams(strategyParams);

      // Update preset defaults baseline if using a preset
      if (activePreset && activePreset !== 'custom') {
        const presetDefaults = getTemplateDefaults(selectedStrategy, activePreset);
        if (presetDefaults) {
          setCurrentPresetDefaults(presetDefaults);
        }
      } else {
        setCurrentPresetDefaults({});
      }

      setTemplateChanged(false);
      setTokensChanged(false);
      setPlatformsChanged(false);
      setParamsChanged(false);
      setHasUnsavedChanges(false);
      setEditMode(false);
      setShowTransactionModal(false);
      setTransactionLoading(false);
    } catch (error) {
      // Always set loading to false first
      setTransactionLoading(false);

      // Check if user cancelled the transaction
      if (error.code === 'ACTION_REJECTED' || error.code === 4001 || error.message?.includes('user rejected')) {
        // User cancelled - set warning and keep modal open
        setTransactionWarning('Transaction cancelled. Strategy configuration incomplete. Automation cannot be enabled until all configuration steps are completed.');
        return;
      }

      // Real error - parse meaningful message, log it, and keep modal open showing error
      const errorMessage = error.reason || error.message || "Unknown error";
      console.error("Strategy configuration failed:", errorMessage);

      // Only set error if not already set by nested catches
      if (!transactionError) {
        setTransactionError(`Failed to save strategy: ${errorMessage}`);
      }
      // Modal stays open to show which step failed
    }
  };

  // Handle cancel button click
  const handleCancel = () => {
    // If we were just setting up a new strategy, revert to original
    if (selectedStrategy !== initialSelectedStrategy) {
      setSelectedStrategy(initialSelectedStrategy);
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

    console.log('setting hasUnsavedChanges & editMode to false...')
    setHasUnsavedChanges(false);
    setEditMode(false);
  };

  // Close transaction modal
  const handleCloseTransactionModal = () => {
    // Trigger data refresh to sync with blockchain state
    dispatch(triggerUpdate());

    // Reset all change tracking flags
    setTemplateChanged(false);
    setTokensChanged(false);
    setPlatformsChanged(false);
    setParamsChanged(false);
    setHasUnsavedChanges(false);

    // Exit edit mode
    setEditMode(false);

    // Clear error and warning messages
    setTransactionError('');
    setTransactionWarning('');

    // Close the modal
    setShowTransactionModal(false);
  };

  // Access current strategy directly from vault for array comparisons
  const currentStrategy = vault?.strategy || null;

  // Render the strategy config panel
  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h4 className="mb-0">Strategy Configuration</h4>
        </div>

        <p>Configure automated management strategies for this vault's positions and tokens.</p>

        {!isDataLoaded && (
          <Alert variant="info">
            Loading strategy configuration...
          </Alert>
        )}

        <div className="mb-4">
          <Form.Group>
            {vault?.hasActiveStrategy && isOwner && !editMode ? (
              <Form.Label style={{ width: '100%' }} >
                <Button
                  variant=""
                  className="btn btn-back"
                  onClick={() => setShowDeactivationModal(true)}
                  style={{ width: '100%' }}
                >
                  Disable Strategy
                </Button>
              </Form.Label>
            ) : (
              <Form.Label><strong>Select Strategy</strong></Form.Label>
            )}
            <Form.Select
              value={selectedStrategy}
              onChange={handleStrategyChange}
              disabled={!isOwner || !isDataLoaded || (vault?.hasActiveStrategy && !hasUnsavedChanges)}
              className="mb-3"
            >
              <option value="">Select a strategy</option>
              {availableStrategies.map(strategy => (
                <option key={strategy.id} value={strategy.id} disabled={strategy.comingSoon}>
                  {strategy.name} - {strategy.subtitle} {strategy.comingSoon ? "(Coming Soon)" : ""}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </div>

        <h5 className="mt-4">Strategy Details</h5>
        <div className="strategy-details p-3 border rounded bg-light">
          {!selectedStrategy ? (
            <Alert variant="info">
              No strategy selected for the vault. Select a strategy to configure automated management.
            </Alert>
          ) : (
            <StrategyDetailsSection
              vaultAddress={vaultAddress}
              isOwner={isOwner}
              strategyId={selectedStrategy}
              strategyActive={vault?.hasActiveStrategy && !hasUnsavedChanges}
              editMode={editMode}
              onEditRequest={handleEditRequest}
              onCancel={handleCancel}
              onValidate={handleSetValidation}
              onParamsChange={handleParamsChange}
              isDataLoaded={isDataLoaded} // Pass loading state to child
            />
          )}
        </div>

        {/* Save/Cancel buttons at the bottom */}
        {isOwner && isDataLoaded && (editMode || hasUnsavedChanges) && (
          <div className="d-flex justify-content-end mt-4">
            <Button
              variant="secondary"
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
      </Card.Body>

      {/* Strategy Deactivation Modal */}
      <StrategyDeactivationModal
        show={showDeactivationModal}
        onHide={() => setShowDeactivationModal(false)}
        onConfirm={handleConfirmDeactivation}
        strategyName={getStrategyName()}
        hasExecutor={vault?.executor !== '0x0000000000000000000000000000000000000000'}
        isLoading={isLoading}
      />

      {/* Strategy Validation Modal */}
      <StrategyValidationModal
        show={showValidationModal}
        onHide={() => {
          setShowValidationModal(false);
          setValidationWarnings([]);
        }}
        onConfirm={() => {
          setShowValidationModal(false);
          setValidationWarnings([]);
          proceedWithSave();
        }}
        warnings={validationWarnings}
      />

      {/* Strategy Transaction Modal */}
      <TransactionProgressModal
        show={showTransactionModal}
        onHide={handleCloseTransactionModal}
        onCancel={() => {
          if (!transactionLoading) {
            handleCloseTransactionModal();
          }
        }}
        currentStep={currentTransactionStep}
        steps={transactionSteps}
        isLoading={transactionLoading}
        error={transactionError}
        warning={transactionWarning}
        tokenSymbols={selectedTokens}
        title={`Configuring Strategy: ${getStrategyName()}`}
      />
    </Card>
  );
};

export default StrategyConfigPanel;
