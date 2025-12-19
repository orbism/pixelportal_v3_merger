// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {PX} from "../src/PX.sol";
import {MockDOG20} from "../test/mocks/MockDOG20.sol";

/**
 * @title DeployLocal
 * @dev Simple deployment script for local Anvil testing
 * 
 * Deploys:
 * 1. MockDOG20 token
 * 2. PX implementation
 * 3. ERC1967Proxy pointing to PX
 * 4. Configures token lock amount
 * 
 * Usage:
 * forge script script/DeployLocal.s.sol:DeployLocal --rpc-url http://localhost:1337 --broadcast --private-key <key>
 */
contract DeployLocal is Script {
    // Constants for local deployment
    uint256 constant SHIBA_WIDTH = 640;
    uint256 constant SHIBA_HEIGHT = 480;
    uint256 constant TOTAL_SUPPLY = SHIBA_WIDTH * SHIBA_HEIGHT; // 307,200
    uint256 constant DOG_TO_PIXEL_SATOSHIS = 5523989899 * 10 ** 13; // 55,240 DOG per pixel

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== DEPLOYING PX LOCALLY ===");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy MockDOG20
        console.log("\n1. Deploying MockDOG20...");
        MockDOG20 dog20 = new MockDOG20();
        console.log("   DOG20 deployed at:", address(dog20));

        // 2. Deploy PX implementation
        console.log("\n2. Deploying PX implementation...");
        PX implementation = new PX();
        console.log("   Implementation deployed at:", address(implementation));

        // 3. Prepare initialization data
        console.log("\n3. Preparing proxy initialization...");
        bytes memory initData = abi.encodeWithSelector(
            PX.__PX_init.selector,
            "Doge Pixels",           // name
            "PX",                     // symbol
            address(dog20),           // DOG20 address
            "ipfs://local-test/",     // ipfsUri
            SHIBA_WIDTH,              // width
            SHIBA_HEIGHT,             // height
            deployer,                 // devFeeAddress
            deployer                  // owner
        );

        // 4. Deploy proxy
        console.log("\n4. Deploying ERC1967Proxy...");
        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), initData);
        console.log("   Proxy deployed at:", address(proxy));

        // 5. Cast proxy to PX interface
        PX pxToken = PX(address(proxy));

        // 6. Configure token lock amount
        console.log("\n5. Configuring token lock amount...");
        pxToken.setTokenLockAmount(address(dog20), DOG_TO_PIXEL_SATOSHIS);
        console.log("   Token lock amount set:", DOG_TO_PIXEL_SATOSHIS);

        // 7. Unpause the contract so minting can work
        console.log("\n6. Unpausing contract...");
        pxToken.unpause();
        console.log("   Contract unpaused");

        // 8. Mint some DOG tokens to deployer for testing
        console.log("\n7. Minting test DOG tokens...");
        uint256 testAmount = DOG_TO_PIXEL_SATOSHIS * 100; // Enough for 100 pixels
        dog20.mint(deployer, testAmount);
        console.log("   Minted", testAmount, "DOG to deployer");

        // 9. Approve PX to spend DOG
        console.log("\n8. Approving PX to spend DOG...");
        dog20.approve(address(pxToken), type(uint256).max);
        console.log("   Approval granted");

        vm.stopBroadcast();

        // Verification
        console.log("\n=== DEPLOYMENT VERIFICATION ===");
        console.log("Token name:", pxToken.name());
        console.log("Token symbol:", pxToken.symbol());
        console.log("Total supply:", pxToken.totalSupply());
        console.log("Puppers remaining:", pxToken.puppersRemaining());
        console.log("Contract paused:", pxToken.paused());
        console.log("Has admin role:", pxToken.hasRole(pxToken.DEFAULT_ADMIN_ROLE(), deployer));
        console.log("DOG balance of deployer:", dog20.balanceOf(deployer));
        console.log("DOG allowance for PX:", dog20.allowance(deployer, address(pxToken)));

        console.log("\n=== DEPLOYMENT SUMMARY ===");
        console.log("DOG20 Token:", address(dog20));
        console.log("PX Implementation:", address(implementation));
        console.log("PX Proxy (Main Contract):", address(proxy));
        console.log("Owner/Deployer:", deployer);
        console.log("Lock Amount per Pixel:", DOG_TO_PIXEL_SATOSHIS);

        console.log("\n=== READY TO USE ===");
        console.log("You can now mint pixels by calling:");
        console.log("  pxToken.mintPupper() at", address(proxy));
        console.log("\nContract addresses for frontend/server:");
        console.log("  PX_CONTRACT_ADDRESS=", address(proxy));
        console.log("  DOG20_CONTRACT_ADDRESS=", address(dog20));
    }
}

