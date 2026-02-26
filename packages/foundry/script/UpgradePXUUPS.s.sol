// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {PX} from "../src/PX.sol";
import {PXV2} from "../src/PXV2.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title UpgradePXUUPS
 * @dev Upgrade script for PX token using UUPS pattern
 *
 * This script upgrades the PX proxy to PXV2 implementation.
 * PXV2 is identical to PX except:
 * - No initialization needed (storage already set from V1)
 * - Burns return 100% of locked tokens (no dev fee)
 *
 * Usage:
 * 1. Set environment variables in .env:
 *    - PRIVATE_KEY: Deployer private key (must have DEFAULT_ADMIN_ROLE)
 *    - RPC_URL: Network RPC URL
 *    - PROXY_ADDRESS: Address of the deployed PX proxy
 *
 * 2. Run the upgrade:
 *    forge script script/UpgradePXUUPS.s.sol:UpgradePXUUPS --rpc-url $RPC_URL --broadcast
 *
 * 3. Verify the new implementation (optional):
 *    forge script script/UpgradePXUUPS.s.sol:UpgradePXUUPS --sig "verifyUpgrade(address)" <proxy> --rpc-url $RPC_URL
 */
contract UpgradePXUUPS is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address proxyAddress = vm.envAddress("PROXY_ADDRESS");

        console.log("=== UUPS UPGRADE: PX -> PXV2 ===");
        console.log("Deployer:", deployer);
        console.log("Proxy:", proxyAddress);

        // Get current state before upgrade
        PX proxy = PX(proxyAddress);

        console.log("");
        console.log("--- Pre-upgrade state ---");

        // Verify deployer has admin role
        bool hasAdminRole = proxy.hasRole(proxy.DEFAULT_ADMIN_ROLE(), deployer);
        console.log("Deployer has DEFAULT_ADMIN_ROLE:", hasAdminRole);
        require(hasAdminRole, "Deployer does not have DEFAULT_ADMIN_ROLE - cannot upgrade");

        // Record current state
        string memory currentName = proxy.name();
        string memory currentSymbol = proxy.symbol();
        uint256 currentTotalSupply = proxy.totalSupply();
        uint256 currentPuppersRemaining = proxy.puppersRemaining();
        bool currentPaused = proxy.paused();

        console.log("Token name:", currentName);
        console.log("Token symbol:", currentSymbol);
        console.log("Total supply:", currentTotalSupply);
        console.log("Puppers remaining:", currentPuppersRemaining);
        console.log("Paused:", currentPaused);

        // Get current implementation
        bytes32 implSlot = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);
        address oldImplementation = address(uint160(uint256(vm.load(proxyAddress, implSlot))));
        console.log("Current implementation:", oldImplementation);

        console.log("");
        console.log("--- Deploying PXV2 implementation ---");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy new PXV2 implementation
        PXV2 newImplementation = new PXV2();
        console.log("New PXV2 implementation deployed at:", address(newImplementation));

        // Perform UUPS upgrade
        console.log("");
        console.log("--- Executing UUPS upgrade ---");
        UUPSUpgradeable(proxyAddress).upgradeToAndCall(address(newImplementation), "");

        vm.stopBroadcast();

        // Verify upgrade
        console.log("");
        console.log("--- Post-upgrade verification ---");

        address currentImplementation = address(uint160(uint256(vm.load(proxyAddress, implSlot))));
        console.log("New implementation:", currentImplementation);
        require(currentImplementation == address(newImplementation), "Upgrade failed - implementation not updated");

        // Verify state preservation
        PXV2 upgradedProxy = PXV2(proxyAddress);

        require(
            keccak256(bytes(upgradedProxy.name())) == keccak256(bytes(currentName)), "State corrupted - name changed"
        );
        require(
            keccak256(bytes(upgradedProxy.symbol())) == keccak256(bytes(currentSymbol)),
            "State corrupted - symbol changed"
        );
        require(upgradedProxy.totalSupply() == currentTotalSupply, "State corrupted - totalSupply changed");
        require(
            upgradedProxy.puppersRemaining() == currentPuppersRemaining, "State corrupted - puppersRemaining changed"
        );
        require(upgradedProxy.paused() == currentPaused, "State corrupted - paused state changed");

        console.log("State preservation verified");
        console.log("");
        console.log("=== UPGRADE SUCCESSFUL ===");
        console.log("Old implementation:", oldImplementation);
        console.log("New implementation:", address(newImplementation));
        console.log("");
        console.log("PXV2 changes:");
        console.log("- Burns now return 100% of locked tokens (no dev fee)");
    }

    /**
     * @dev Verify an upgrade was successful and state is preserved
     */
    function verifyUpgrade(address proxyAddress) external view {
        console.log("=== VERIFYING UPGRADE ===");
        console.log("Proxy:", proxyAddress);

        PXV2 proxy = PXV2(proxyAddress);

        console.log("");
        console.log("--- Contract State ---");
        console.log("Name:", proxy.name());
        console.log("Symbol:", proxy.symbol());
        console.log("Total supply:", proxy.totalSupply());
        console.log("Puppers remaining:", proxy.puppersRemaining());
        console.log("Paused:", proxy.paused());
        console.log("SHIBA_WIDTH:", proxy.SHIBA_WIDTH());
        console.log("SHIBA_HEIGHT:", proxy.SHIBA_HEIGHT());
        console.log("INDEX_OFFSET:", proxy.INDEX_OFFSET());

        bytes32 implSlot = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);
        address implementation = address(uint160(uint256(vm.load(proxyAddress, implSlot))));
        console.log("");
        console.log("Implementation address:", implementation);

        console.log("");
        console.log("=== VERIFICATION COMPLETE ===");
    }
}
