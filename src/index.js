/**
 * F.U.M. Automation Service
 * @module fum_automation
 * @description Multi-strategy, multi-platform DeFi automation service
 * @since 2.0.0
 */

// Core modules
export * from './core/index.js';

// Utility modules
export * from './utils/index.js';

// Strategy modules
export * from './strategies/index.js';

// Platform utility modules
export * from './platformUtils/index.js';

// Default export for main service
export { AutomationService as default } from './core/index.js';
