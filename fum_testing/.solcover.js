module.exports = {
  skipFiles: [
    // Mock contracts — test-infrastructure only, no direct tests
    'MockERC20.sol',
    'MockLBPair.sol',
    'MockLBRouter.sol',
    'MockNonfungiblePositionManager.sol',
    'MockPermit2.sol',
    'MockPositionNFT.sol',
    'MockUniversalRouter.sol',
    'MockWETH.sol',
    // Test actors — not mocks of real contracts, but test helpers with specific behavior
    'MaliciousOwner.sol',
  ],
  configureYulOptimizer: true,
};
