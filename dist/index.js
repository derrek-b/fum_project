/**
 * FUM Library - Main Entry Point
 * 
 * This module provides a unified interface for interacting with DeFi protocols.
 * It exports helper utilities and platform adapters for building
 * decentralized finance applications.
 * 
 * @module fum-library
 */

// Load environment variables from .env file
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from library root
config({ path: resolve(__dirname, '../.env') });

export * from './helpers/index.js';
export * from './adapters/index.js';
export * from './blockchain/index.js';
export * from './services/index.js';
