#!/bin/bash

# Define directories - modify as needed
SOURCE_DIR="$(pwd)"
TARGET_DIR="$HOME/temp-hardhat-test"
ENV_FILE=".env.local"

echo "Syncing from $SOURCE_DIR to $TARGET_DIR..."

# Create target directories
mkdir -p "$TARGET_DIR"

# Ensure contracts directory exists
mkdir -p "$TARGET_DIR/contracts"
mkdir -p "$TARGET_DIR/test/unit"

# Preserve directory structure for contracts
echo "Copying Solidity contracts..."
find "$SOURCE_DIR/contracts" -name "*.sol" -type f | while read -r file; do
    relative_path="${file#$SOURCE_DIR/}"
    target_file="$TARGET_DIR/$relative_path"
    mkdir -p "$(dirname "$target_file")"
    cp "$file" "$target_file"
done

# Preserve directory structure for tests
echo "Copying test files..."
find "$SOURCE_DIR/test" -name "*.js" -type f | while read -r file; do
    relative_path="${file#$SOURCE_DIR/}"
    target_file="$TARGET_DIR/$relative_path"
    mkdir -p "$(dirname "$target_file")"
    cp "$file" "$target_file"
done

# Copy environment file if it exists
if [ -f "$SOURCE_DIR/$ENV_FILE" ]; then
    echo "Copying environment file..."
    cp "$SOURCE_DIR/$ENV_FILE" "$TARGET_DIR/.env"
else
    echo "Warning: Environment file $ENV_FILE not found"
fi

echo "Sync completed!"./
