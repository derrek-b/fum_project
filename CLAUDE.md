# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Run a script: `npm run script path/to/script.js` or `tsx path/to/script.js`
- Run test automation: `npm run start` or `npm run script scripts/test-automation.js`
- Run test automation with log server: `npm run start:logs` or `npm run script scripts/test-automation.js --logs`
- Customize log server port: `npm run script scripts/test-automation.js --logs --log-port 8080`
- Pack and reinstall fum_library: `npm run pack`

## Code Style Guidelines

- **Imports**: Use ES module imports (import/export). Group imports by: built-in modules, external dependencies, local modules.
- **Formatting**: Use 2 spaces for indentation.
- **Classes**: Organize methods logically: constructor, static methods, lifecycle methods, class methods, utility methods.
- **Error Handling**: Use try/catch blocks with specific error messages. Log errors with `console.error()`.
- **Naming**: Use camelCase for variables/functions, PascalCase for classes, and UPPER_CASE for constants.
- **Async/Await**: Prefer async/await over promise chains.
- **Comments**: Document class purposes and complex methods. Use JSDoc-style comments for public APIs.
- **File Structure**: Follow the established pattern of platform-specific strategy implementations.

When adding new strategies, follow the pattern established with BabyStepsStrategy, using proper inheritance and platform-specific implementations.
- Data structure format is saved in /docs/architecture/cache-structures.md
- Do NOT assume what is or is not part of the data structure or the contracts or the library modules; look up code you want to call or use before you use it.