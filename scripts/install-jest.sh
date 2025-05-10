#!/bin/bash
# Script to install Jest dependencies and run tests

echo "Installing Jest and related dependencies..."
npm install --save-dev jest@latest jest-environment-node@latest

echo "Testing Jest setup..."
node --experimental-vm-modules node_modules/jest/bin/jest.js --verbose tests/unit/

echo "Installation complete!"
echo "To run tests, use: npm test"