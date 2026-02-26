#!/bin/bash

# Generate calldata for Safe multisig transactions
# Usage: ./generate-calldata.sh <function-signature> [args...]
# Example: ./generate-calldata.sh "unpause()"
# Example: ./generate-calldata.sh "setBaseUri(string)" "https://example.com/"

set -e

if [ $# -lt 1 ]; then
    echo "Usage: $0 <function-signature> [args...]"
    echo ""
    echo "Examples:"
    echo "  $0 \"unpause()\""
    echo "  $0 \"pause()\""
    echo "  $0 \"setBaseUri(string)\" \"https://example.com/\""
    echo "  $0 \"setTokenLockAmount(address,uint256)\" \"0x123...\" \"1000000000000000000\""
    exit 1
fi

FUNCTION_SIG="$1"
shift

# Generate calldata using cast
CALLDATA=$(cast calldata "$FUNCTION_SIG" "$@")

# Create output filename based on function name
FUNC_NAME=$(echo "$FUNCTION_SIG" | sed 's/(.*//')
OUTPUT_FILE="calldata-${FUNC_NAME}.txt"

# Write calldata to file
echo "$CALLDATA" > "$OUTPUT_FILE"

echo "Generated calldata for: $FUNCTION_SIG"
echo "Calldata: $CALLDATA"
echo "Saved to: $OUTPUT_FILE"
echo ""
echo "To propose this transaction via Safe, run:"
echo "  node index.js $OUTPUT_FILE"
