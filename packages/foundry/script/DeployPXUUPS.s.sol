// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {PX} from "../src/PX.sol";
import {DeployConfig} from "./DeployConfig.sol";

/**
 * @title DeployPXUUPS
 * @dev Modern deployment script for PX token using UUPS pattern with CREATE2
 *
 * This deployment script follows current best practices:
 * - Uses UUPS (Universal Upgradeable Proxy Standard) pattern
 * - Deploys using Nick's CREATE2 factory for deterministic addresses
 * - More gas efficient than transparent proxies
 * - Self-contained upgrade logic in implementation
 *
 * Usage:
 * forge script script/DeployPXUUPS.s.sol:DeployPXUUPS --rpc-url $RPC_URL --broadcast --verify
 */
contract DeployPXUUPS is Script {
    address constant NICK_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Read token address and lock amount from environment
        address dog20Address = vm.envAddress("DOG20_TOKEN_ADDRESS");
        uint256 defaultLockAmount = vm.envUint("DEFAULT_LOCK_AMOUNT");

        DeployConfig.NetworkConfig memory config = DeployConfig.getConfigForChainId(block.chainid, dog20Address);

        console.log("=== DEPLOYING PX WITH UUPS ===");
        console.log("Network:", config.name);
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("DOG20 Address:", dog20Address);
        console.log("Default Lock Amount:", defaultLockAmount);

        vm.startBroadcast(deployerPrivateKey);

        console.log("Using Nick's CREATE2 factory at:", NICK_FACTORY);

        PX implementation = new PX();
        console.log("Implementation deployed at:", address(implementation));

        bytes memory initData = abi.encodeWithSelector(
            PX.__PX_init.selector,
            config.tokenName,
            config.tokenSymbol,
            config.dog20Address,
            config.ipfsUri,
            config.shibaWidth,
            config.shibaHeight,
            config.devFeeAddress,
            deployer
        );

        bytes memory bytecode = abi.encodePacked(type(ERC1967Proxy).creationCode, abi.encode(implementation, initData));

        bytes32 salt = keccak256("PX_UUPS_v1");

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
        PX pxToken = PX(proxyAddress);
        if (dog20Address != address(0)) {
            pxToken.setTokenLockAmount(dog20Address, defaultLockAmount);
            console.log("Token lock amount set for DOG20:", defaultLockAmount);
        }

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

        // Read token address from environment
        address dog20Address = vm.envAddress("DOG20_TOKEN_ADDRESS");

        DeployConfig.NetworkConfig memory config = DeployConfig.getConfigForChainId(block.chainid, dog20Address);

        console.log("Network:", config.name);
        console.log("Chain ID:", block.chainid);
        uint256 salt = uint256(keccak256("PX_UUPS_v1"));
        console.log("Salt:", vm.toString(salt));

        console.log("\nDeployment parameters:");
        console.log("Token name:", config.tokenName);
        console.log("Token symbol:", config.tokenSymbol);
        console.log("DOG20 address:", config.dog20Address);
        console.log("IPFS URI:", config.ipfsUri);
        console.log("Shiba width:", config.shibaWidth);
        console.log("Shiba height:", config.shibaHeight);
        console.log("Dev fee address:", config.devFeeAddress);

        console.log("\nThis deployment will create:");
        console.log("1. PX implementation contract (UUPS upgradeable)");
        console.log("2. ERC1967Proxy contract (user interface)");
        console.log("3. Uses CREATE2 for deterministic addresses");
    }
}
