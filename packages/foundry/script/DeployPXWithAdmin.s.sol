// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {PX} from "../src/PX.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {DeployConfig} from "./DeployConfig.sol";

/**
 * @title DeployPXWithAdmin
 * @dev Enhanced deployment script for PX token using ProxyAdmin pattern
 *
 * This deployment script follows current best practices:
 * - Uses TransparentUpgradeableProxy with dedicated ProxyAdmin
 * - Provides better separation of concerns for upgrades
 * - More secure upgrade management with dedicated admin contract
 *
 * Usage:
 * forge script script/DeployPXWithAdmin.s.sol:DeployPXWithAdmin --rpc-url $RPC_URL --broadcast --verify
 */
contract DeployPXWithAdmin is Script {
    // Salt for deterministic deployment
    bytes32 constant SALT = keccak256("PX_TOKEN_WITH_ADMIN_V1");

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Read token address and lock amount from environment
        address dog20Address = vm.envAddress("DOG20_TOKEN_ADDRESS");
        uint256 defaultLockAmount = vm.envUint("DEFAULT_LOCK_AMOUNT");

        // Get network configuration
        DeployConfig.NetworkConfig memory config = DeployConfig.getConfigForChainId(block.chainid, dog20Address);

        console.log("=== DEPLOYING PX WITH PROXY ADMIN ===");
        console.log("Network:", config.name);
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("DOG20 Address:", dog20Address);
        console.log("Default Lock Amount:", defaultLockAmount);
        console.log("Salt:", vm.toString(SALT));

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy ProxyAdmin
        ProxyAdmin proxyAdmin = new ProxyAdmin(deployer);
        console.log("ProxyAdmin deployed at:", address(proxyAdmin));

        // 2. Deploy implementation
        PX implementation = new PX();
        console.log("Implementation deployed at:", address(implementation));

        // 3. Prepare initialization data
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

        // 4. Deploy TransparentUpgradeableProxy
        TransparentUpgradeableProxy proxy =
            new TransparentUpgradeableProxy(address(implementation), address(proxyAdmin), initData);
        console.log("Proxy deployed at:", address(proxy));

        // 5. Configure token lock amount
        PX pxToken = PX(address(proxy));
        if (dog20Address != address(0)) {
            pxToken.setTokenLockAmount(dog20Address, defaultLockAmount);
            console.log("Token lock amount set for DOG20:", defaultLockAmount);
        }

        vm.stopBroadcast();

        // Verify deployment
        console.log("\n=== DEPLOYMENT VERIFICATION ===");
        console.log("Token name:", pxToken.name());
        console.log("Token symbol:", pxToken.symbol());
        console.log("Total supply:", pxToken.totalSupply());
        console.log("Puppers remaining:", pxToken.puppersRemaining());
        console.log("Contract paused:", pxToken.paused());

        console.log("\n=== DEPLOYMENT SUMMARY ===");
        console.log("ProxyAdmin:", address(proxyAdmin));
        console.log("Implementation:", address(implementation));
        console.log("Proxy (PX Token):", address(proxy));
        console.log("ProxyAdmin Owner:", proxyAdmin.owner());

        // Security check
        require(proxyAdmin.owner() == deployer, "ProxyAdmin owner mismatch");
        require(pxToken.hasRole(pxToken.DEFAULT_ADMIN_ROLE(), deployer), "PX token admin role mismatch");

        console.log("\nDeployment completed successfully!");
        console.log("\nIMPORTANT NOTES:");
        console.log("- ProxyAdmin contract controls upgrades");
        console.log("- Only ProxyAdmin owner can upgrade the implementation");
        console.log("- Consider transferring ProxyAdmin ownership to a multisig");
    }

    /**
     * @dev Preview deployment addresses without actually deploying
     */
    function previewDeployment() external view {
        console.log("=== ENHANCED DEPLOYMENT PREVIEW ===");

        // Read token address from environment
        address dog20Address = vm.envAddress("DOG20_TOKEN_ADDRESS");

        // Get network configuration
        DeployConfig.NetworkConfig memory config = DeployConfig.getConfigForChainId(block.chainid, dog20Address);

        console.log("Network:", config.name);
        console.log("Chain ID:", block.chainid);
        console.log("Salt:", vm.toString(SALT));

        console.log("\nDeployment parameters:");
        console.log("Token name:", config.tokenName);
        console.log("Token symbol:", config.tokenSymbol);
        console.log("DOG20 address:", config.dog20Address);
        console.log("IPFS URI:", config.ipfsUri);
        console.log("Shiba width:", config.shibaWidth);
        console.log("Shiba height:", config.shibaHeight);
        console.log("Dev fee address:", config.devFeeAddress);

        console.log("\nThis deployment will create:");
        console.log("1. ProxyAdmin contract (manages upgrades)");
        console.log("2. PX implementation contract");
        console.log("3. TransparentUpgradeableProxy contract (user interface)");
    }

    /**
     * @dev Helper function to transfer ProxyAdmin ownership
     * Use this after deployment to transfer control to a multisig
     */
    function transferProxyAdminOwnership(address proxyAdmin, address newOwner) external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        console.log("=== TRANSFERRING PROXY ADMIN OWNERSHIP ===");
        console.log("ProxyAdmin:", proxyAdmin);
        console.log("New Owner:", newOwner);

        vm.startBroadcast(deployerPrivateKey);

        ProxyAdmin(proxyAdmin).transferOwnership(newOwner);

        vm.stopBroadcast();

        console.log("ProxyAdmin ownership transferred successfully");
        console.log("New owner must call acceptOwnership() to complete transfer");
    }
}
