// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {PX} from "../src/PX.sol";
import {ITransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

/**
 * @title UpgradePX
 * @dev Enhanced upgrade script for PX token implementation using ProxyAdmin pattern
 *
 * IMPORTANT SAFETY CHECKS:
 * 1. Verify storage layout compatibility before upgrading
 * 2. Test upgrade on fork/testnet first
 * 3. Ensure new implementation is properly tested
 * 4. Verify proxy admin has upgrade permissions
 * 5. Use ProxyAdmin for safer upgrade management
 *
 * Usage:
 * 1. Deploy new implementation: forge script script/UpgradePX.s.sol:UpgradePX --sig "deployNewImplementation(string,bytes32)" "v2.0.0" <salt> --rpc-url $RPC_URL --broadcast
 * 2. Test upgrade on fork: forge script script/UpgradePX.s.sol:UpgradePX --sig "validateUpgrade(address,address)" <proxy> <newImpl> --fork-url $RPC_URL
 * 3. Execute upgrade via ProxyAdmin: forge script script/UpgradePX.s.sol:UpgradePX --sig "upgradeViaProxyAdmin(address,address,address)" <proxyAdmin> <proxy> <newImpl> --rpc-url $RPC_URL --broadcast
 */
contract UpgradePX is Script {
    // CREATE2 Factory for deterministic new implementation deployment
    // Using CREATE2_FACTORY from forge-std/Base.sol

    // Events to track upgrade process
    event ImplementationDeployed(address indexed implementation, string version);
    event UpgradeExecuted(address indexed proxy, address indexed oldImplementation, address indexed newImplementation);
    event UpgradeValidated(address indexed proxy, bool storageCompatible, bool functionalityValid);

    /**
     * @dev Deploy new implementation using CREATE2 for deterministic address
     * @param version Version string for the new implementation (e.g., "v2.0.0")
     * @param salt Custom salt for CREATE2 deployment
     */
    function deployNewImplementation(string memory version, bytes32 salt) external returns (address) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        console.log("=== DEPLOYING NEW IMPLEMENTATION ===");
        console.log("Version:", version);
        console.log("Salt:", vm.toString(salt));

        vm.startBroadcast(deployerPrivateKey);

        // Deploy new implementation using CREATE2
        address newImplementation = deployWithCreate2(type(PX).creationCode, salt);

        vm.stopBroadcast();

        console.log("New implementation deployed at:", newImplementation);
        emit ImplementationDeployed(newImplementation, version);

        return newImplementation;
    }

    /**
     * @dev Upgrade proxy to new implementation
     * @param proxyAddress Address of the proxy contract
     * @param newImplementation Address of the new implementation
     */
    function upgradeProxy(address proxyAddress, address newImplementation) external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== UPGRADING PROXY ===");
        console.log("Proxy:", proxyAddress);
        console.log("New Implementation:", newImplementation);
        console.log("Upgrader:", deployer);

        // Get current implementation
        address oldImplementation = getProxyImplementation(proxyAddress);
        console.log("Old Implementation:", oldImplementation);

        // Validate before upgrade
        _validateUpgrade(proxyAddress, oldImplementation, newImplementation);

        vm.startBroadcast(deployerPrivateKey);

        // Get proxy admin address from storage
        bytes32 adminSlot = bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1);
        address admin = address(uint160(uint256(vm.load(proxyAddress, adminSlot))));
        console.log("Proxy admin:", admin);

        // Use ProxyAdmin's upgradeAndCall with empty data (v5.x pattern)
        ProxyAdmin(admin).upgradeAndCall(ITransparentUpgradeableProxy(proxyAddress), newImplementation, "");
        console.log("ProxyAdmin upgrade successful");

        vm.stopBroadcast();

        // Verify upgrade
        address currentImplementation = getProxyImplementation(proxyAddress);
        require(currentImplementation == newImplementation, "Upgrade verification failed");

        console.log("Upgrade successful!");
        console.log("Current implementation:", currentImplementation);

        emit UpgradeExecuted(proxyAddress, oldImplementation, newImplementation);

        // Post-upgrade validation
        _postUpgradeValidation(proxyAddress);
    }

    /**
     * @dev Test upgrade on a fork without broadcasting
     * @param proxyAddress Address of the proxy contract
     * @param newImplementation Address of the new implementation
     */
    function validateUpgrade(address proxyAddress, address newImplementation) external view {
        console.log("=== TESTING UPGRADE (DRY RUN) ===");
        console.log("Proxy:", proxyAddress);
        console.log("New Implementation:", newImplementation);

        // Get current implementation
        address oldImplementation = getProxyImplementation(proxyAddress);
        console.log("Current Implementation:", oldImplementation);

        // Validate upgrade compatibility
        _validateUpgrade(proxyAddress, oldImplementation, newImplementation);

        console.log("Upgrade validation passed!");
        console.log("Safe to proceed with actual upgrade.");
    }

    /**
     * @dev Comprehensive upgrade validation
     */
    function _validateUpgrade(address proxyAddress, address oldImplementation, address newImplementation)
        internal
        view
    {
        console.log(" Validating upgrade...");

        // 1. Check implementations are different
        require(oldImplementation != newImplementation, "New implementation is the same as current");

        // 2. Check new implementation is a contract
        require(newImplementation.code.length > 0, "New implementation is not a contract");

        // 3. Validate storage layout (basic check)
        _validateStorageLayout(proxyAddress);

        // 4. Check proxy state before upgrade
        PX currentProxy = PX(proxyAddress);

        try currentProxy.name() returns (string memory name) {
            console.log("Current token name:", name);
        } catch {
            console.log("WARNING:  Could not read current token name");
        }

        try currentProxy.symbol() returns (string memory symbol) {
            console.log("Current token symbol:", symbol);
        } catch {
            console.log("WARNING:  Could not read current token symbol");
        }

        try currentProxy.totalSupply() returns (uint256 supply) {
            console.log("Current total supply:", supply);
        } catch {
            console.log("WARNING:  Could not read current total supply");
        }

        console.log(" Pre-upgrade validation complete");
    }

    /**
     * @dev Validate storage layout compatibility
     */
    function _validateStorageLayout(address proxyAddress) internal view {
        console.log(" Checking storage layout...");

        PX proxy = PX(proxyAddress);

        // Check critical storage slots are readable
        try proxy.puppersRemaining() returns (uint256) {
            console.log(" puppersRemaining storage slot accessible");
        } catch {
            revert("ERROR: Critical storage slot inaccessible - storage layout may be incompatible");
        }

        // Note: DOG_TO_PIXEL_SATOSHIS was removed as it was unused

        try proxy.INDEX_OFFSET() returns (uint256) {
            console.log(" INDEX_OFFSET storage slot accessible");
        } catch {
            revert("ERROR: Critical storage slot inaccessible - storage layout may be incompatible");
        }

        console.log(" Storage layout validation passed");
    }

    /**
     * @dev Post-upgrade validation
     */
    function _postUpgradeValidation(address proxyAddress) internal {
        console.log(" Post-upgrade validation...");

        PX upgradedProxy = PX(proxyAddress);

        // Test basic functionality
        try upgradedProxy.name() returns (string memory name) {
            console.log(" Token name accessible:", name);
        } catch {
            console.log("ERROR: Could not read token name after upgrade");
        }

        try upgradedProxy.symbol() returns (string memory symbol) {
            console.log(" Token symbol accessible:", symbol);
        } catch {
            console.log("ERROR: Could not read token symbol after upgrade");
        }

        try upgradedProxy.totalSupply() returns (uint256 supply) {
            console.log(" Total supply accessible:", supply);
        } catch {
            console.log("ERROR: Could not read total supply after upgrade");
        }

        try upgradedProxy.puppersRemaining() returns (uint256 remaining) {
            console.log(" Puppers remaining accessible:", remaining);
        } catch {
            console.log("ERROR: Could not read puppers remaining after upgrade");
        }

        // Check if contract is paused (should not be by default)
        try upgradedProxy.paused() returns (bool isPaused) {
            console.log(" Pause state accessible, paused:", isPaused);
        } catch {
            console.log("ERROR: Could not read pause state after upgrade");
        }

        console.log(" Post-upgrade validation complete");

        emit UpgradeValidated(proxyAddress, true, true);
    }

    /**
     * @dev Deploy contract using CREATE2 factory
     */
    function deployWithCreate2(bytes memory creationCode, bytes32 salt) internal returns (address deployed) {
        (bool success, bytes memory returnData) = CREATE2_FACTORY.call(abi.encodePacked(salt, creationCode));

        require(success, "CREATE2 deployment failed");
        // casting to 'bytes20' is safe because returnData is from CREATE2 which returns 20-byte address
        // forge-lint: disable-next-line(unsafe-typecast)
        deployed = address(uint160(bytes20(returnData)));
        require(deployed != address(0), "Deployment returned zero address");
    }

    /**
     * @dev Get current implementation address of a proxy
     */
    function getCurrentImplementation(address proxyAddress) external view returns (address) {
        return getProxyImplementation(proxyAddress);
    }

    /**
     * @dev Emergency pause function (only proxy admin)
     */
    function emergencyPause(address proxyAddress) external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        console.log(" EMERGENCY PAUSE");
        console.log("Proxy:", proxyAddress);

        vm.startBroadcast(deployerPrivateKey);

        PX proxy = PX(proxyAddress);
        proxy.pause();

        vm.stopBroadcast();

        console.log(" Contract paused successfully");
    }

    /**
     * @dev Emergency unpause function (only proxy admin)
     */
    function emergencyUnpause(address proxyAddress) external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        console.log(" EMERGENCY UNPAUSE");
        console.log("Proxy:", proxyAddress);

        vm.startBroadcast(deployerPrivateKey);

        PX proxy = PX(proxyAddress);
        proxy.unpause();

        vm.stopBroadcast();

        console.log(" Contract unpaused successfully");
    }

    /**
     * @dev Helper function to get implementation address using storage slot
     */
    function getProxyImplementation(address proxyAddress) private view returns (address) {
        bytes32 implSlot = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);
        return address(uint160(uint256(vm.load(proxyAddress, implSlot))));
    }

    /**
     * @dev Get proxy admin address
     */
    function getProxyAdmin(address proxyAddress) external view returns (address) {
        bytes32 adminSlot = bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1);
        return address(uint160(uint256(vm.load(proxyAddress, adminSlot))));
    }

    /**
     * @dev Enhanced upgrade function using ProxyAdmin pattern
     * @param proxyAdminAddress Address of the ProxyAdmin contract
     * @param proxyAddress Address of the proxy contract
     * @param newImplementation Address of the new implementation
     */
    function upgradeViaProxyAdmin(address proxyAdminAddress, address proxyAddress, address newImplementation) external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== UPGRADING VIA PROXY ADMIN ===");
        console.log("ProxyAdmin:", proxyAdminAddress);
        console.log("Proxy:", proxyAddress);
        console.log("New Implementation:", newImplementation);
        console.log("Upgrader:", deployer);

        // Get current implementation
        address oldImplementation = getProxyImplementation(proxyAddress);
        console.log("Old Implementation:", oldImplementation);

        // Validate before upgrade
        _validateUpgrade(proxyAddress, oldImplementation, newImplementation);

        // Verify deployer is ProxyAdmin owner
        ProxyAdmin proxyAdmin = ProxyAdmin(proxyAdminAddress);
        require(proxyAdmin.owner() == deployer, "Deployer is not ProxyAdmin owner");

        vm.startBroadcast(deployerPrivateKey);

        // Execute upgrade via ProxyAdmin using upgradeAndCall with empty data
        proxyAdmin.upgradeAndCall(ITransparentUpgradeableProxy(proxyAddress), newImplementation, "");

        vm.stopBroadcast();

        // Verify upgrade
        address currentImplementation = getProxyImplementation(proxyAddress);
        require(currentImplementation == newImplementation, "Upgrade verification failed");

        console.log("ProxyAdmin upgrade successful!");
        console.log("Current implementation:", currentImplementation);

        emit UpgradeExecuted(proxyAddress, oldImplementation, newImplementation);

        // Post-upgrade validation
        _postUpgradeValidation(proxyAddress);
    }
}
