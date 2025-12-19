# PX Token Tests

This directory contains comprehensive Foundry tests for the PX token, equivalent to the original Hardhat test suite.

## Test Files

### 📁 Core Tests
- **`PX.t.sol`** - Main test suite covering all basic functionality
- **`PXStress.t.sol`** - Stress tests and edge cases with intensive operations

### 📁 Supporting Files
- **`mocks/MockDOG20.sol`** - Mock DOG20 token for testing
- **`utils/TestUtils.sol`** - Utility functions (equivalent to utils.js)

## Test Coverage

### ✅ Basic Functionality (PX.t.sol)
- Minting single and multiple puppers
- Burning puppers with fee distribution
- Transfer functionality
- Pause/unpause mechanisms
- Owner permissions
- Metadata and URI generation
- Pixel coordinate calculations
- Random minting verification
- Burn and re-mint cycles
- Gas usage optimization

### ✅ Upgrade Testing (PXUpgradeTest)
- V2 contract upgrades
- Batch minting functionality
- Cooldown mechanisms
- Enhanced metadata

### 🔥 Stress Testing (PXStress.t.sol)
- Mint entire supply sequentially
- Burn entire supply in random order
- Random mint/burn cycles
- Multi-user concurrent operations
- Large batch operations
- Edge cases and error conditions
- Fee distribution accuracy
- Gas efficiency measurements
- Supply invariant verification

## Equivalent Hardhat Tests

These Foundry tests replicate the functionality from:
- `/doge-pixels/packages/hardhat/test/PX.test.js`
- `/doge-pixels/packages/hardhat/test/utils.js`

### Key Equivalencies:
| Hardhat Function | Foundry Equivalent |
|------------------|-------------------|
| `mintPupperWithValidation()` | `mintPupperWithValidation()` |
| `burnPupperWithValidation()` | `burnPupperWithValidation()` |
| `getShardIndex()` | `TestUtils.getShardIndex()` |
| `range()` | `TestUtils.range()` |
| `shuffle()` | `TestUtils.shuffle()` |
| `randFromArray()` | `TestUtils.randFromArray()` |

## Running Tests

### 🏃 Quick Test Run
```bash
# Run all tests
forge test

# Run specific test file
forge test --match-path test/PX.t.sol

# Run with verbosity
forge test -vvv
```

### 🔍 Detailed Testing
```bash
# Run basic functionality tests
forge test --match-contract PXTest

# Run upgrade tests  
forge test --match-contract PXUpgradeTest

# Run stress tests
forge test --match-contract PXStressTest

# Run specific test function
forge test --match-test test_MintEntireSupply
```

### 📊 Gas Reports
```bash
# Generate gas report
forge test --gas-report

# Test with gas optimization
forge test --optimize --optimizer-runs 200
```

### 🔄 Fork Testing
```bash
# Test against mainnet fork
forge test --fork-url $ETH_RPC_URL

# Test against specific block
forge test --fork-url $ETH_RPC_URL --fork-block-number 18000000
```

## Test Configuration

### Environment Variables
```bash
# Optional: Set RPC URLs for fork testing
export ETH_RPC_URL="https://..."
export POLYGON_RPC_URL="https://..."
```

### Foundry.toml Settings
The tests use the existing foundry.toml configuration with:
- Solidity version: ^0.8.0
- Optimizer: Enabled
- Gas limit: Sufficient for stress tests

## Test Parameters

### Mock Values (Configurable)
- **Mock Width**: 10-680 pixels (adjustable via CROP factor)
- **Mock Height**: 10-480 pixels  
- **DOG to Pixel Rate**: 5523989899 * 10^13 wei
- **Burn Fees**: 1% total (0.4% dev, 0.6% PleasrDAO)
- **Index Offset**: 1,000,000
- **Shard Size**: 5,000 tokens

### Performance Notes
- Basic tests use small supply (100-200 tokens) for speed
- Stress tests can handle full supply minting/burning
- Gas measurements included for optimization
- Fuzz testing available for random scenarios

## Debugging

### Common Issues
1. **Insufficient DOG balance**: Tests automatically mint DOG tokens
2. **Gas limit exceeded**: Reduce MOCK_SUPPLY in stress tests
3. **Randomness**: Tests account for non-deterministic minting

### Debug Commands
```bash
# Debug specific test with traces
forge test --match-test testName -vvvv

# Debug with stack traces
forge test --match-test testName --debug

# Check test coverage
forge coverage
```

## Contributing

When adding new tests:
1. Follow existing naming conventions
2. Add appropriate helper functions to TestUtils
3. Include both positive and negative test cases
4. Test edge cases and error conditions
5. Measure gas usage for optimization
6. Document expected behavior clearly

## Comparison with Original

These tests maintain 100% functional equivalence with the original Hardhat tests while providing:
- ✅ Better performance (faster execution)
- ✅ More detailed gas reporting
- ✅ Enhanced debugging capabilities
- ✅ Fuzz testing integration
- ✅ Fork testing support
- ✅ Type safety with Solidity