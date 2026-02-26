// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestDOG is ERC20 {
    constructor(address recipient) ERC20("Test DOG", "DOG") {
        _mint(recipient, 100_000_000 * 10 ** 18);
    }
}

contract DeployTestDOG is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== DEPLOYING TEST DOG TOKEN ===");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        TestDOG dog = new TestDOG(deployer);

        vm.stopBroadcast();

        console.log("\n=== DEPLOYMENT COMPLETE ===");
        console.log("TestDOG deployed at:", address(dog));
        console.log("Deployer balance:", dog.balanceOf(deployer) / 1e18, "DOG");

        console.log("\n=== ACTION REQUIRED ===");
        console.log("Update your .env file with:");
        console.log("DOG20_TOKEN_ADDRESS=", address(dog));
    }
}
