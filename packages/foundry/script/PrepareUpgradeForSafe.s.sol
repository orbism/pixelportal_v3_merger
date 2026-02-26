// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {PX} from "../src/PX.sol";
import {PXV2} from "../src/PXV2.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title PrepareUpgradeForSafe
 * @dev Deploys new PXV2 implementation and generates calldata for Safe multisig upgrade
 *
 * This script:
 * 1. Deploys the new PXV2 implementation contract
 * 2. Generates the upgradeToAndCall calldata
 * 3. Writes calldata to a file for use with safe-deployer
 * 4. Outputs the command to execute via Safe
 *
 * Usage:
 * 1. Set environment variables in .env:
 *    - PRIVATE_KEY: Deployer private key
 *    - RPC_URL: Network RPC URL
 *    - PROXY_ADDRESS: Address of the deployed PX proxy
 *    - ETHERSCAN_API_KEY: API key for contract verification
 *
 * 2. Run the script:
 *    source .env && forge script script/PrepareUpgradeForSafe.s.sol:PrepareUpgradeForSafe --rpc-url $RPC_URL --broadcast --verify --etherscan-api-key $ETHERSCAN_API_KEY
 *
 * 3. Execute via Safe:
 *    cd safe-deployer && node index.js calldata-upgrade.txt
 */
contract PrepareUpgradeForSafe is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address proxyAddress = vm.envAddress("PROXY_ADDRESS");

        console.log("=== PREPARE UPGRADE FOR SAFE MULTISIG ===");
        console.log("Deployer:", deployer);
        console.log("Proxy:", proxyAddress);

        // Get current state before upgrade
        PX proxy = PX(proxyAddress);

        console.log("");
        console.log("--- Pre-upgrade state ---");

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

        vm.stopBroadcast();

        // Generate calldata for upgradeToAndCall
        bytes memory upgradeCalldata =
            abi.encodeWithSelector(UUPSUpgradeable.upgradeToAndCall.selector, address(newImplementation), "");

        console.log("");
        console.log("--- Generated Upgrade Calldata ---");
        console.log("Calldata:");
        console.logBytes(upgradeCalldata);

        // Write calldata to file
        string memory calldataHex = vm.toString(upgradeCalldata);
        string memory outputPath = "safe-deployer/calldata-upgrade.txt";
        vm.writeFile(outputPath, calldataHex);

        console.log("");
        console.log("--- Output ---");
        console.log("Calldata written to:", outputPath);
        console.log("");
        console.log("--- Implementation Verification ---");
        console.log("If you did not use --verify flag, verify the implementation with:");
        console.log(
            "  forge verify-contract",
            address(newImplementation),
            "src/PXV2.sol:PXV2 --chain base-sepolia --etherscan-api-key $ETHERSCAN_API_KEY --watch"
        );
        console.log("");
        console.log("--- Next Steps ---");
        console.log("To execute upgrade via Safe multisig, run:");
        console.log("  cd safe-deployer && node index.js calldata-upgrade.txt");
        console.log("");
        console.log("After Safe execution, verify upgrade state with:");
        console.log(
            "  forge script script/PrepareUpgradeForSafe.s.sol:PrepareUpgradeForSafe --sig \"verifyUpgrade(address)\" --rpc-url $RPC_URL",
            proxyAddress
        );
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
