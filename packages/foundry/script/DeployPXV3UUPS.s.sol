// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {PXV3} from "../src/PXV3.sol";

/**
 * @title DeployPXV3UUPS
 * @dev Modern deployment script for PX token using UUPS pattern with CREATE2
 *
 * This deployment script follows current best practices:
 * - Uses UUPS (Universal Upgradeable Proxy Standard) pattern
 * - Deploys using Nick's CREATE2 factory for deterministic addresses
 * - More gas efficient than transparent proxies
 * - Self-contained upgrade logic in implementation
 *
 * All configuration is read from environment variables.
 * Use the appropriate .env file for your target network:
 * - .env-base-sepolia for Base Sepolia testnet
 * - .env-base-mainnet for Base mainnet
 *
 * Usage:
 * forge script script/DeployPXV3UUPS.s.sol:DeployPXV3UUPS --rpc-url $RPC_URL --broadcast --verify
 */
contract DeployPXV3UUPS is Script {
    address constant NICK_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // INCREMENT WHEN YOU WANT TO CHANGE THE DEPLOY ADDRESS
    bytes32 salt = keccak256("PXV3_UUPS_v1");

    function run() external {
        // Verify environment is properly configured
        string memory networkName = vm.envString("NETWORK_NAME");
        require(bytes(networkName).length > 0, "NETWORK_NAME must be set - ensure correct .env file is loaded");

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Read all configuration from environment
        address dog20Address = vm.envAddress("DOG20_TOKEN_ADDRESS");
        require(dog20Address != address(0), "DOG20_TOKEN_ADDRESS must be set to a valid non-zero address");

        uint256 defaultLockAmount = vm.envUint("DEFAULT_LOCK_AMOUNT");
        require(defaultLockAmount > 0, "DEFAULT_LOCK_AMOUNT must be set to a non-zero value");

        string memory tokenName = vm.envString("TOKEN_NAME");
        require(bytes(tokenName).length > 0, "TOKEN_NAME must be set");

        string memory tokenSymbol = vm.envString("TOKEN_SYMBOL");
        require(bytes(tokenSymbol).length > 0, "TOKEN_SYMBOL must be set");

        string memory baseUri = vm.envString("BASE_URI");
        require(bytes(baseUri).length > 0, "BASE_URI must be set");

        uint256 shibaWidth = vm.envUint("SHIBA_WIDTH");
        require(shibaWidth > 0, "SHIBA_WIDTH must be set to a non-zero value");

        uint256 shibaHeight = vm.envUint("SHIBA_HEIGHT");
        require(shibaHeight > 0, "SHIBA_HEIGHT must be set to a non-zero value");

        address devFeeAddress = vm.envAddress("DEV_FEE_ADDRESS");
        require(devFeeAddress != address(0), "DEV_FEE_ADDRESS must be set to a valid non-zero address");

        console.log("=== DEPLOYING PX WITH UUPS ===");
        console.log("Network:", networkName);
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("DOG20 Address:", dog20Address);
        console.log("Default Lock Amount:", defaultLockAmount);
        console.log("Token Name:", tokenName);
        console.log("Token Symbol:", tokenSymbol);
        console.log("Base URI:", baseUri);
        console.log("Shiba Width:", shibaWidth);
        console.log("Shiba Height:", shibaHeight);
        console.log("Dev Fee Address:", devFeeAddress);

        vm.startBroadcast(deployerPrivateKey);

        console.log("Using Nick's CREATE2 factory at:", NICK_FACTORY);

        PXV3 implementation = new PXV3();
        console.log("Implementation deployed at:", address(implementation));

        bytes memory initData = abi.encodeWithSelector(
            PXV3.__PX_init.selector,
            tokenName,
            tokenSymbol,
            dog20Address,
            baseUri,
            shibaWidth,
            shibaHeight,
            devFeeAddress,
            deployer
        );

        bytes memory bytecode = abi.encodePacked(type(ERC1967Proxy).creationCode, abi.encode(implementation, initData));

        bytes memory deployData = abi.encodePacked(salt, bytecode);

        (bool success, bytes memory returnData) = NICK_FACTORY.call(deployData);
        require(success, "Nick's factory deployment failed");

        require(returnData.length == 20, "Invalid return data length from Nick's factory");
        address proxyAddress;
        assembly {
            proxyAddress := mload(add(returnData, 20))
        }

        console.log("Proxy deployed at:", proxyAddress);
        console.log("Salt used:", vm.toString(salt));

        // Configure token lock amount
        PXV3 pxToken = PXV3(proxyAddress);
        pxToken.setTokenLockAmount(dog20Address, defaultLockAmount);
        console.log("Token lock amount set for DOG20:", defaultLockAmount);

        // Grant pause manager role
        address pauseManager1 = 0xf3A3d7f87EE5b778D3A50A6f7d8F16f7141Bd132;
        address pauseManager2 = 0x1c563dCDb1a53c264f6bc94d783E9d4B25636C05;
        pxToken.grantRole(pxToken.PAUSE_MANAGER_ROLE(), pauseManager1);
        pxToken.grantRole(pxToken.PAUSE_MANAGER_ROLE(), pauseManager2);
        console.log("Pause manager role granted to:", pauseManager1);
        console.log("Pause manager role granted to:", pauseManager2);

        // Grant burn flag manager role
        address burnFlagManager = 0x6cc0eF15b62F440173Da4c1f063A51fC2642fbD3;
        pxToken.grantRole(pxToken.BURN_FLAG_MANAGER_ROLE(), burnFlagManager);
        console.log("Burn flag manager role granted to:", burnFlagManager);

        vm.stopBroadcast();
        console.log("\n=== DEPLOYMENT VERIFICATION ===");
        console.log("Token name:", pxToken.name());
        console.log("Token symbol:", pxToken.symbol());
        console.log("Total supply:", pxToken.totalSupply());
        console.log("Puppers remaining:", pxToken.puppersRemaining());
        console.log("Contract paused:", pxToken.paused());
        console.log("Has admin role:", pxToken.hasRole(pxToken.DEFAULT_ADMIN_ROLE(), deployer));

        console.log("\n=== DEPLOYMENT SUMMARY ===");
        console.log("Implementation:", address(implementation));
        console.log("Proxy (PX Token):", proxyAddress);
        console.log("Owner:", deployer);

        require(pxToken.hasRole(pxToken.DEFAULT_ADMIN_ROLE(), deployer), "PX token admin role mismatch");

        console.log("\nDeployment completed successfully!");
        console.log("\nIMPORTANT NOTES:");
        console.log("- Contract uses UUPS upgrade pattern");
        console.log("- Only contract owner can authorize upgrades");
        console.log("- Upgrade logic is in the implementation contract");
        console.log("- More gas efficient than transparent proxies");
    }

    /**
     * @dev Preview deployment addresses without actually deploying
     */
    function previewDeployment() external view {
        console.log("=== UUPS DEPLOYMENT PREVIEW ===");

        // Verify environment is properly configured
        string memory networkName = vm.envString("NETWORK_NAME");
        require(bytes(networkName).length > 0, "NETWORK_NAME must be set - ensure correct .env file is loaded");

        address dog20Address = vm.envAddress("DOG20_TOKEN_ADDRESS");
        string memory tokenName = vm.envString("TOKEN_NAME");
        string memory tokenSymbol = vm.envString("TOKEN_SYMBOL");
        string memory baseUri = vm.envString("BASE_URI");
        uint256 shibaWidth = vm.envUint("SHIBA_WIDTH");
        uint256 shibaHeight = vm.envUint("SHIBA_HEIGHT");
        address devFeeAddress = vm.envAddress("DEV_FEE_ADDRESS");

        console.log("Network:", networkName);
        console.log("Chain ID:", block.chainid);
        console.log("Salt:", vm.toString(salt));

        console.log("\nDeployment parameters:");
        console.log("Token name:", tokenName);
        console.log("Token symbol:", tokenSymbol);
        console.log("DOG20 address:", dog20Address);
        console.log("Base URI:", baseUri);
        console.log("Shiba width:", shibaWidth);
        console.log("Shiba height:", shibaHeight);
        console.log("Dev fee address:", devFeeAddress);

        console.log("\nThis deployment will create:");
        console.log("1. PX implementation contract (UUPS upgradeable)");
        console.log("2. ERC1967Proxy contract (user interface)");
        console.log("3. Uses CREATE2 for deterministic addresses");
    }
}
