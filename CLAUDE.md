# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Run automation service: `npm run start`
- Run tests: `npm test`
- Run tests in watch mode: `npm run test:watch`
- Sync fum_library for local development: `cd ../fum_library && npm run sync`
- Restore GitHub dependency: `cd ../fum_library && npm run unsync`

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
- Mark debugging logs with special emoji so they are easy to find