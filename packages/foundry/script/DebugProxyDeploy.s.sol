// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {PX} from "../src/PX.sol";

/**
 * @title DebugProxyDeploy
 * @dev Debug script to test proxy deployment without CREATE2
 *
 * All configuration is read from environment variables.
 */
contract DebugProxyDeploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Read all configuration from environment
        address dog20Address = vm.envAddress("DOG20_TOKEN_ADDRESS");
        uint256 defaultLockAmount = vm.envUint("DEFAULT_LOCK_AMOUNT");
        string memory tokenName = vm.envString("TOKEN_NAME");
        string memory tokenSymbol = vm.envString("TOKEN_SYMBOL");
        string memory baseUri = vm.envString("BASE_URI");
        uint256 shibaWidth = vm.envUint("SHIBA_WIDTH");
        uint256 shibaHeight = vm.envUint("SHIBA_HEIGHT");
        address devFeeAddress = vm.envAddress("DEV_FEE_ADDRESS");

        console.log("=== DEBUG PROXY DEPLOYMENT ===");
        console.log("Deployer:", deployer);
        console.log("DOG20 Address:", dog20Address);
        console.log("Default Lock Amount:", defaultLockAmount);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy implementation contract
        PX implementation = new PX();
        console.log("Implementation deployed at:", address(implementation));

        // Prepare initialization data
        bytes memory initData = abi.encodeWithSelector(
            PX.__PX_init.selector,
            tokenName,
            tokenSymbol,
            dog20Address,
            baseUri,
            shibaWidth,
            shibaHeight,
            devFeeAddress,
            deployer // Pass deployer as owner
        );

        console.log("InitData length:", initData.length);
        console.logBytes(initData);

        // Try to deploy ERC1967Proxy directly
        try new ERC1967Proxy(address(implementation), initData) returns (ERC1967Proxy proxy) {
            console.log("Proxy deployed successfully at:", address(proxy));

            // Test the proxy
            PX pxToken = PX(address(proxy));
            console.log("Token name:", pxToken.name());
            console.log("Has admin role:", pxToken.hasRole(pxToken.DEFAULT_ADMIN_ROLE(), deployer));

            // Configure token lock amount
            if (dog20Address != address(0)) {
                pxToken.setTokenLockAmount(dog20Address, defaultLockAmount);
                console.log("Token lock amount set for DOG20:", defaultLockAmount);
            }
        } catch Error(string memory reason) {
            console.log("Proxy deployment failed with reason:", reason);
        } catch (bytes memory lowLevelData) {
            console.log("Proxy deployment failed with low-level error");
            console.logBytes(lowLevelData);
        }

        vm.stopBroadcast();
    }
}
