// src/components/CreatePositionControl.js
import React, { useState, useEffect, useMemo } from "react";
import { useSelector } from "react-redux";
import {
  Card,
  Form,
  InputGroup,
  Button,
  Alert,
  Row,
  Col,
  Badge,
  Spinner,
  ListGroup,
  OverlayTrigger,
  Tooltip
} from "react-bootstrap";
import { X, Info, ArrowsExpand, ArrowDown } from 'react-bootstrap-icons';
import Image from "next/image";
import { getAvailablePlatforms, getPlatformById } from "../../utils/config";
import { formatUnits, formatPrice } from "../../utils/formatHelpers";
import config from "../../utils/config";

/**
 * Component for creating or editing a liquidity position
 */
const CreatePositionControl = ({
  index,
  onUpdate,
  onRemove,
  supportedTokens,
  supportedPlatforms,
  initialData,
  vaultBalance,
  showRemoveButton = true
}) => {
  // Get chain and other data from Redux
  const { chainId } = useSelector((state) => state.wallet);
  const allTokenConfigs = useSelector((state) => state.tokens);

  // Component state
  const [formData, setFormData] = useState({
    token0: "",
    token1: "",
    feeTier: "3000", // Default to 0.3%
    platformId: "",
    // Price range
    priceRangeMode: "auto", // 'auto', 'manual', 'full'
    priceRangeWidth: 5, // 5% range for auto mode
    priceLower: "",
    priceUpper: "",
    // Amounts
    amount0: "",
    amount1: "",
    // Use percentage of available balance
    usePercentage: false,
    percentage0: 50,
    percentage1: 50,
    // Current price from oracle/dex (would be fetched)
    currentPrice: 0
  });

  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [pricesLoading, setPricesLoading] = useState(false);

  // Derived values
  const tokensSelected = formData.token0 && formData.token1;
  const platformSelected = !!formData.platformId;
  const feeTierOptions = [
    { value: "100", label: "0.01% - Very low fee (best for stablecoins)" },
    { value: "500", label: "0.05% - Low fee (stable pairs)" },
    { value: "3000", label: "0.3% - Medium fee (most pairs)" },
    { value: "10000", label: "1% - High fee (exotic pairs)" }
  ];

  // Get available platforms for the current chain
  const availablePlatforms = useMemo(() => {
    return supportedPlatforms || getAvailablePlatforms(chainId || 1);
  }, [supportedPlatforms, chainId]);

  // Get available tokens based on props
  const availableTokens = useMemo(() => {
    if (supportedTokens) {
      // Filter to only supported tokens
      return Object.entries(allTokenConfigs)
        .filter(([symbol]) => supportedTokens.includes(symbol))
        .reduce((acc, [symbol, data]) => {
          acc[symbol] = data;
          return acc;
        }, {});
    }
    return allTokenConfigs;
  }, [supportedTokens, allTokenConfigs]);

  // Get available token balances
  const tokenBalances = useMemo(() => {
    if (!vaultBalance) return {};

    // Map string balance values to usable format
    return Object.entries(vaultBalance).reduce((acc, [symbol, balance]) => {
      const tokenConfig = availableTokens[symbol];
      if (!tokenConfig) return acc;

      acc[symbol] = {
        raw: balance,
        formatted: typeof balance === 'string' ? balance : formatUnits(balance, tokenConfig.decimals || 18)
      };
      return acc;
    }, {});
  }, [vaultBalance, availableTokens]);

  // Initialize from initialData if provided
  useEffect(() => {
    if (initialData) {
      setFormData(prev => ({
        ...prev,
        ...initialData
      }));
    }
  }, [initialData]);

  // Initialize platform if there's only one available
  useEffect(() => {
    if (availablePlatforms.length === 1 && !formData.platformId) {
      setFormData(prev => ({
        ...prev,
        platformId: availablePlatforms[0].id
      }));
    }
  }, [availablePlatforms, formData.platformId]);

  // When tokens or platform changes, attempt to fetch current price
  useEffect(() => {
    const fetchPrice = async () => {
      if (!formData.token0 || !formData.token1 || !formData.platformId) {
        return;
      }

      setPricesLoading(true);
      try {
        // In a real implementation, this would fetch price from the DEX or an oracle
        // Mock implementation for now
        setTimeout(() => {
          // Simulate price fetch for common pairs
          let mockPrice = 0;
          if ((formData.token0 === "USDC" && formData.token1 === "USDT") ||
              (formData.token0 === "USDT" && formData.token1 === "USDC")) {
            mockPrice = 1.0002;
          } else if ((formData.token0 === "USDC" && formData.token1 === "DAI") ||
                    (formData.token0 === "DAI" && formData.token1 === "USDC")) {
            mockPrice = 1.002;
          } else if ((formData.token0 === "WETH" && formData.token1 === "USDC") ||
                    (formData.token0 === "USDC" && formData.token1 === "WETH")) {
            mockPrice = 2500;
          } else {
            mockPrice = 1.0;
          }

          // Ensure we have the price in the right direction
          const finalPrice = formData.token0 < formData.token1 ? mockPrice : 1 / mockPrice;

          setFormData(prev => ({
            ...prev,
            currentPrice: finalPrice,
            // Update price range based on auto settings
            priceLower: finalPrice * (1 - prev.priceRangeWidth / 100),
            priceUpper: finalPrice * (1 + prev.priceRangeWidth / 100)
          }));

          setPricesLoading(false);
        }, 500);
      } catch (error) {
        console.error("Error fetching price:", error);
        setPricesLoading(false);
        setErrors(prev => ({ ...prev, price: "Failed to fetch current price" }));
      }
    };

    fetchPrice();
  }, [formData.token0, formData.token1, formData.platformId, formData.priceRangeWidth]);

  // Update parent component when form data changes
  useEffect(() => {
    // Don't update parent if we don't have the minimum required fields
    if (!formData.token0 || !formData.token1 || !formData.platformId) {
      return;
    }

    // Basic validation
    const validationErrors = validateForm();
    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    onUpdate({
      index,
      token0: formData.token0,
      token1: formData.token1,
      feeTier: formData.feeTier,
      platformId: formData.platformId,
      priceRangeMode: formData.priceRangeMode,
      priceLower: formData.priceLower,
      priceUpper: formData.priceUpper,
      amount0: formData.amount0,
      amount1: formData.amount1
    });
  }, [formData, index, onUpdate]);

  // Form validation
  const validateForm = () => {
    const newErrors = {};

    // Required fields
    if (!formData.token0) newErrors.token0 = "Token 0 is required";
    if (!formData.token1) newErrors.token1 = "Token 1 is required";
    if (formData.token0 === formData.token1) newErrors.token1 = "Tokens must be different";
    if (!formData.platformId) newErrors.platformId = "Platform is required";

    // Price range validation
    if (formData.priceRangeMode === 'manual') {
      if (!formData.priceLower) newErrors.priceLower = "Lower price is required";
      if (!formData.priceUpper) newErrors.priceUpper = "Upper price is required";
      if (parseFloat(formData.priceLower) >= parseFloat(formData.priceUpper)) {
        newErrors.priceRange = "Upper price must be greater than lower price";
      }
    }

    // Amount validation
    if (!formData.amount0 && !formData.amount1) {
      newErrors.amounts = "At least one token amount is required";
    }

    // Check if amounts exceed available balance
    if (tokenBalances[formData.token0] && parseFloat(formData.amount0) > parseFloat(tokenBalances[formData.token0].formatted)) {
      newErrors.amount0 = `Exceeds available balance of ${tokenBalances[formData.token0].formatted}`;
    }

    if (tokenBalances[formData.token1] && parseFloat(formData.amount1) > parseFloat(tokenBalances[formData.token1].formatted)) {
      newErrors.amount1 = `Exceeds available balance of ${tokenBalances[formData.token1].formatted}`;
    }

    setErrors(newErrors);
    return newErrors;
  };

  // Handle form field changes
  const handleChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));

    // Clear specific error when field is updated
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  // Handle token selection
  const handleTokenChange = (position, symbol) => {
    const field = position === 0 ? 'token0' : 'token1';

    // If selecting the same token that's already in the other position, swap them
    if ((position === 0 && symbol === formData.token1) ||
        (position === 1 && symbol === formData.token0)) {
      setFormData(prev => ({
        ...prev,
        token0: position === 0 ? symbol : prev.token1,
        token1: position === 1 ? symbol : prev.token0,
        // Reset amounts when swapping
        amount0: position === 0 ? prev.amount1 : prev.amount0,
        amount1: position === 1 ? prev.amount0 : prev.amount1
      }));
    } else {
      // Otherwise just update the selected position
      setFormData(prev => ({
        ...prev,
        [field]: symbol,
        // Reset amount for the changed token
        [position === 0 ? 'amount0' : 'amount1']: ""
      }));
    }

    // Clear errors related to token selection
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors.token0;
      delete newErrors.token1;
      return newErrors;
    });
  };

  // Handle price range mode change
  const handleRangeModeChange = (mode) => {
    setFormData(prev => {
      const newState = {
        ...prev,
        priceRangeMode: mode
      };

      // Update price bounds based on mode
      if (mode === 'auto' && prev.currentPrice) {
        newState.priceLower = prev.currentPrice * (1 - prev.priceRangeWidth / 100);
        newState.priceUpper = prev.currentPrice * (1 + prev.priceRangeWidth / 100);
      } else if (mode === 'full') {
        // Full range is effectively "infinite" - we use very large/small numbers
        newState.priceLower = 0.00000001;
        newState.priceUpper = 1000000000;
      }

      return newState;
    });

    // Clear price range errors
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors.priceLower;
      delete newErrors.priceUpper;
      delete newErrors.priceRange;
      return newErrors;
    });
  };

  // Handle price range width change (for auto mode)
  const handleRangeWidthChange = (width) => {
    setFormData(prev => {
      const newWidth = parseFloat(width);
      const newState = {
        ...prev,
        priceRangeWidth: newWidth
      };

      // Update bounds if in auto mode
      if (prev.priceRangeMode === 'auto' && prev.currentPrice) {
        newState.priceLower = prev.currentPrice * (1 - newWidth / 100);
        newState.priceUpper = prev.currentPrice * (1 + newWidth / 100);
      }

      return newState;
    });
  };

  // Handle max button click for token amounts
  const handleMaxClick = (tokenIndex) => {
    const token = tokenIndex === 0 ? formData.token0 : formData.token1;
    const field = tokenIndex === 0 ? 'amount0' : 'amount1';

    if (tokenBalances[token]) {
      setFormData(prev => ({
        ...prev,
        [field]: tokenBalances[token].formatted
      }));

      // Clear error for this field
      if (errors[field]) {
        setErrors(prev => {
          const newErrors = { ...prev };
          delete newErrors[field];
          delete newErrors.amounts;
          return newErrors;
        });
      }
    }
  };

  // Handle percentage change for amounts
  const handlePercentageChange = (tokenIndex, percentage) => {
    const token = tokenIndex === 0 ? formData.token0 : formData.token1;
    const field = tokenIndex === 0 ? 'amount0' : 'amount1';
    const percentageField = tokenIndex === 0 ? 'percentage0' : 'percentage1';

    setFormData(prev => {
      const newState = {
        ...prev,
        [percentageField]: percentage
      };

      // If we have balance, calculate amount based on percentage
      if (tokenBalances[token]) {
        const balance = parseFloat(tokenBalances[token].formatted);
        newState[field] = (balance * percentage / 100).toString();
      }

      return newState;
    });

    // Clear errors
    if (errors[field] || errors.amounts) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        delete newErrors.amounts;
        return newErrors;
      });
    }
  };

  // Handle use percentage toggle
  const handleUsePercentageToggle = (usePercent) => {
    setFormData(prev => ({
      ...prev,
      usePercentage: usePercent
    }));

    // If enabling percentage, update amounts based on current percentages
    if (usePercent) {
      if (tokenBalances[formData.token0]) {
        const balance0 = parseFloat(tokenBalances[formData.token0].formatted);
        handleChange('amount0', (balance0 * formData.percentage0 / 100).toString());
      }

      if (tokenBalances[formData.token1]) {
        const balance1 = parseFloat(tokenBalances[formData.token1].formatted);
        handleChange('amount1', (balance1 * formData.percentage1 / 100).toString());
      }
    }
  };

  // Render token selector
  const renderTokenSelector = (position) => {
    const tokenField = position === 0 ? 'token0' : 'token1';
    const selectedToken = formData[tokenField];
    const error = errors[tokenField];

    return (
      <Form.Group className="mb-3">
        <Form.Label>{`Token ${position + 1}`}</Form.Label>
        <div className="position-relative">
          <Form.Select
            value={selectedToken}
            onChange={(e) => handleTokenChange(position, e.target.value)}
            isInvalid={!!error}
          >
            <option value="">Select token...</option>
            {Object.entries(availableTokens).map(([symbol, token]) => (
              <option
                key={symbol}
                value={symbol}
                // Disable if this token is selected in the other position
                disabled={(position === 0 && symbol === formData.token1) ||
                          (position === 1 && symbol === formData.token0)}
              >
                {symbol} - {token.name}
              </option>
            ))}
          </Form.Select>

          {selectedToken && (
            <div className="position-absolute top-50 translate-middle-y" style={{ right: '40px' }}>
              {availableTokens[selectedToken]?.logoURI ? (
                <Image
                  src={availableTokens[selectedToken].logoURI}
                  width={24}
                  height={24}
                  alt={selectedToken}
                />
              ) : (
                <div className="token-icon-placeholder">{selectedToken.substring(0, 2)}</div>
              )}
            </div>
          )}

          <Form.Control.Feedback type="invalid">
            {error}
          </Form.Control.Feedback>
        </div>
      </Form.Group>
    );
  };

  // Render the platform selector
  const renderPlatformSelector = () => {
    return (
      <Form.Group className="mb-3">
        <Form.Label>Platform</Form.Label>
        <div className="position-relative">
          <Form.Select
            value={formData.platformId}
            onChange={(e) => handleChange('platformId', e.target.value)}
            isInvalid={!!errors.platformId}
          >
            <option value="">Select platform...</option>
            {availablePlatforms.map(platform => (
              <option key={platform.id} value={platform.id}>
                {platform.name}
              </option>
            ))}
          </Form.Select>

          {formData.platformId && (
            <div className="position-absolute top-50 translate-middle-y" style={{ right: '40px' }}>
              {(() => {
                const platform = getPlatformById(formData.platformId, chainId);
                if (platform?.logo) {
                  return (
                    <Image
                      src={platform.logo}
                      width={24}
                      height={24}
                      alt={platform.name}
                    />
                  );
                }
                return null;
              })()}
            </div>
          )}

          <Form.Control.Feedback type="invalid">
            {errors.platformId}
          </Form.Control.Feedback>
        </div>
      </Form.Group>
    );
  };

  // Render fee tier selector
  const renderFeeTierSelector = () => {
    return (
      <Form.Group className="mb-3">
        <Form.Label>Fee Tier</Form.Label>
        <OverlayTrigger
          placement="top"
          overlay={
            <Tooltip>
              Higher fee tiers are better for volatile pairs, while lower fees work best for stable pairs
            </Tooltip>
          }
        >
          <span className="ms-1 text-muted">
            <Info size={14} />
          </span>
        </OverlayTrigger>

        <Form.Select
          value={formData.feeTier}
          onChange={(e) => handleChange('feeTier', e.target.value)}
        >
          {feeTierOptions.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Form.Select>
      </Form.Group>
    );
  };

  // Render price range controls
  const renderPriceRangeControls = () => {
    return (
      <div className="price-range-section mb-4">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <Form.Label className="mb-0">Price Range</Form.Label>

          {pricesLoading ? (
            <Spinner animation="border" size="sm" />
          ) : (
            <Badge bg="secondary">
              Current Price: {formatPrice(formData.currentPrice)} {formData.token1}/{formData.token0}
            </Badge>
          )}
        </div>

        <div className="range-mode-selector mb-3">
          <div className="d-flex flex-wrap gap-2">
            <Form.Check
              type="radio"
              id="range-auto"
              label="Auto Range"
              inline
              checked={formData.priceRangeMode === 'auto'}
              onChange={() => handleRangeModeChange('auto')}
            />
            <Form.Check
              type="radio"
              id="range-manual"
              label="Manual Range"
              inline
              checked={formData.priceRangeMode === 'manual'}
              onChange={() => handleRangeModeChange('manual')}
            />
            <Form.Check
              type="radio"
              id="range-full"
              label="Full Range"
              inline
              checked={formData.priceRangeMode === 'full'}
              onChange={() => handleRangeModeChange('full')}
            />
          </div>
        </div>

        {formData.priceRangeMode === 'auto' && (
          <div className="auto-range-controls mb-3">
            <Form.Label>Range Width (±%)</Form.Label>
            <InputGroup>
              <Form.Control
                type="number"
                value={formData.priceRangeWidth}
                onChange={(e) => handleRangeWidthChange(e.target.value)}
                min="0.1"
                max="100"
                step="0.1"
              />
              <InputGroup.Text>%</InputGroup.Text>
            </InputGroup>
            <Form.Text>
              Position will cover price range from{' '}
              {formatPrice(formData.priceLower)} to {formatPrice(formData.priceUpper)}
            </Form.Text>
          </div>
        )}

        {formData.priceRangeMode === 'manual' && (
          <Row className="manual-range-controls mb-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>Min Price</Form.Label>
                <InputGroup>
                  <Form.Control
                    type="number"
                    value={formData.priceLower}
                    onChange={(e) => handleChange('priceLower', e.target.value)}
                    min="0"
                    step="any"
                    isInvalid={!!errors.priceLower}
                  />
                  <InputGroup.Text>{formData.token1}/{formData.token0}</InputGroup.Text>
                </InputGroup>
                <Form.Control.Feedback type="invalid">
                  {errors.priceLower}
                </Form.Control.Feedback>
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group>
                <Form.Label>Max Price</Form.Label>
                <InputGroup>
                  <Form.Control
                    type="number"
                    value={formData.priceUpper}
                    onChange={(e) => handleChange('priceUpper', e.target.value)}
                    min="0"
                    step="any"
                    isInvalid={!!errors.priceUpper}
                  />
                  <InputGroup.Text>{formData.token1}/{formData.token0}</InputGroup.Text>
                </InputGroup>
                <Form.Control.Feedback type="invalid">
                  {errors.priceUpper}
                </Form.Control.Feedback>
              </Form.Group>
            </Col>

            {errors.priceRange && (
              <div className="text-danger mt-2 small">{errors.priceRange}</div>
            )}
          </Row>
        )}

        {formData.priceRangeMode === 'full' && (
          <div className="full-range-info mb-3">
            <Alert variant="info">
              <ArrowsExpand className="me-2" />
              Full range positions provide liquidity across all prices, but are less capital efficient.
            </Alert>
          </div>
        )}
      </div>
    );
  };

  // Render token amount inputs
  const renderAmountInputs = () => {
    return (
      <div className="amount-inputs mb-4">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <Form.Label className="mb-0">Token Amounts</Form.Label>

          <Form.Check
            type="switch"
            id="use-percentage-switch"
            label="Use Percentage"
            checked={formData.usePercentage}
            onChange={(e) => handleUsePercentageToggle(e.target.checked)}
            disabled={!tokenBalances[formData.token0] && !tokenBalances[formData.token1]}
          />
        </div>

        {errors.amounts && (
          <Alert variant="danger" className="py-1 px-2 mb-2">
            <small>{errors.amounts}</small>
          </Alert>
        )}

        <div className="token0-amount mb-3">
          <div className="d-flex justify-content-between align-items-center mb-1">
            <small>
              {formData.token0}{' '}
              {tokenBalances[formData.token0] && (
                <span className="text-muted">
                  (Balance: {tokenBalances[formData.token0].formatted})
                </span>
              )}
            </small>

            {tokenBalances[formData.token0] && (
              <Button
                variant="link"
                size="sm"
                className="p-0"
                onClick={() => handleMaxClick(0)}
              >
                MAX
              </Button>
            )}
          </div>

          {formData.usePercentage ? (
            <div>
              <Form.Range
                value={formData.percentage0}
                onChange={(e) => handlePercentageChange(0, parseInt(e.target.value))}
                min="0"
                max="100"
              />
              <div className="d-flex justify-content-between">
                <small>0%</small>
                <small>{formData.percentage0}%</small>
                <small>100%</small>
              </div>
            </div>
          ) : (
            <InputGroup>
              <Form.Control
                type="number"
                value={formData.amount0}
                onChange={(e) => handleChange('amount0', e.target.value)}
                placeholder="0.0"
                min="0"
                step="any"
                isInvalid={!!errors.amount0}
              />
              <InputGroup.Text>{formData.token0}</InputGroup.Text>
            </InputGroup>
          )}

          {formData.usePercentage && formData.amount0 ? (
            <div className="text-end mt-1">
              <small className="text-muted">≈ {parseFloat(formData.amount0).toFixed(6)} {formData.token0}</small>
            </div>
          ) : null}

          {errors.amount0 && (
            <Form.Control.Feedback type="invalid" style={{ display: 'block' }}>
              {errors.amount0}
            </Form.Control.Feedback>
          )}
        </div>

        <div className="text-center my-2">
          <ArrowDown />
        </div>

        <div className="token1-amount mb-3">
          <div className="d-flex justify-content-between align-items-center mb-1">
            <small>
              {formData.token1}{' '}
              {tokenBalances[formData.token1] && (
                <span className="text-muted">
                  (Balance: {tokenBalances[formData.token1].formatted})
                </span>
              )}
            </small>

            {tokenBalances[formData.token1] && (
              <Button
                variant="link"
                size="sm"
                className="p-0"
                onClick={() => handleMaxClick(1)}
              >
                MAX
              </Button>
            )}
          </div>

          {formData.usePercentage ? (
            <div>
              <Form.Range
                value={formData.percentage1}
                onChange={(e) => handlePercentageChange(1, parseInt(e.target.value))}
                min="0"
                max="100"
              />
              <div className="d-flex justify-content-between">
                <small>0%</small>
                <small>{formData.percentage1}%</small>
                <small>100%</small>
              </div>
            </div>
          ) : (
            <InputGroup>
              <Form.Control
                type="number"
                value={formData.amount1}
                onChange={(e) => handleChange('amount1', e.target.value)}
                placeholder="0.0"
                min="0"
                step="any"
                isInvalid={!!errors.amount1}
              />
              <InputGroup.Text>{formData.token1}</InputGroup.Text>
            </InputGroup>
          )}

          {formData.usePercentage && formData.amount1 ? (
            <div className="text-end mt-1">
              <small className="text-muted">≈ {parseFloat(formData.amount1).toFixed(6)} {formData.token1}</small>
            </div>
          ) : null}

          {errors.amount1 && (
            <Form.Control.Feedback type="invalid" style={{ display: 'block' }}>
              {errors.amount1}
            </Form.Control.Feedback>
          )}
        </div>
      </div>
    );
  };

  return (
    <Card className="mb-4">
      <Card.Header className="d-flex justify-content-between align-items-center">
        <h5 className="mb-0">New Liquidity Position {index > 0 ? `#${index + 1}` : ''}</h5>

        {showRemoveButton && (
          <Button
            variant="outline-danger"
            size="sm"
            onClick={onRemove}
            title="Remove Position"
          >
            <X size={18} />
          </Button>
        )}
      </Card.Header>

      <Card.Body>
        <Row>
          <Col md={6}>
            {renderTokenSelector(0)}
          </Col>
          <Col md={6}>
            {renderTokenSelector(1)}
          </Col>
        </Row>

        <Row>
          <Col md={6}>
            {renderPlatformSelector()}
          </Col>
          <Col md={6}>
            {renderFeeTierSelector()}
          </Col>
        </Row>

        {tokensSelected && platformSelected && (
          <>
            {renderPriceRangeControls()}
            {renderAmountInputs()}
          </>
        )}

        {Object.keys(errors).length > 0 &&
         Object.keys(errors).some(key => !['token0', 'token1', 'platformId', 'amount0', 'amount1', 'priceLower', 'priceUpper', 'priceRange', 'amounts'].includes(key)) && (
          <Alert variant="danger" className="mt-3">
            Please correct the errors before continuing.
          </Alert>
        )}
      </Card.Body>
    </Card>
  );
};

export default CreatePositionControl;
