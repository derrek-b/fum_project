# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Run a script: `npm run script path/to/script.js` or `tsx path/to/script.js`
- Run test automation: `npm run script scripts/test-automation.js`
- Link local fum_library: `npm run dev:link`
- Unlink and reinstall fum_library: `npm run dev:unlink`

## Code Style Guidelines

- **Imports**: Use ES module imports (import/export). Group imports by: built-in modules, external dependencies, local modules.
- **Formatting**: Use 2 spaces for indentation. 
- **Classes**: Organize methods logically: constructor, static methods, lifecycle methods, class methods, utility methods.
- **Error Handling**: Use try/catch blocks with specific error messages. Log errors with `console.error()`.
- **Naming**: Use camelCase for variables/functions, PascalCase for classes, and UPPER_CASE for constants.
- **Async/Await**: Prefer async/await over promise chains.
- **Comments**: Document class purposes and complex methods. Use JSDoc-style comments for public APIs.
- **File Structure**: Follow the established pattern of platform-specific strategy implementations.

When adding new strategies, follow the pattern established with BabyStepsStrategy and ParrisIslandStrategy, using proper inheritance and platform-specific implementations.