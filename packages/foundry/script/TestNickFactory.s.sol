// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";

interface ICreate2Factory {
    function deploy(bytes memory _initCode, bytes32 _salt) external returns (address payable);
}

// Simple dummy contract for testing
contract DummyContract {
    uint256 public value;

    constructor(uint256 _value) {
        value = _value;
    }

    function getValue() external view returns (uint256) {
        return value;
    }
}

// Even simpler contract with no constructor
contract SimpleDummy {
    uint256 public constant VALUE = 42;

    function getValue() external pure returns (uint256) {
        return VALUE;
    }
}

contract TestNickFactory is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== TESTING NICK'S CREATE2 FACTORY ===");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        address NICK_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
        ICreate2Factory factory = ICreate2Factory(NICK_FACTORY);

        console.log("Testing Nick's factory at:", NICK_FACTORY);

        // Test 1: Deploy simplest possible contract (no constructor)
        console.log("\n--- Test 1: SimpleDummy (no constructor) ---");
        bytes memory simpleBytecode = type(SimpleDummy).creationCode;
        bytes32 simpleSalt = keccak256("SimpleDummy_v1");

        console.log("Bytecode length:", simpleBytecode.length);

        // Nick's factory expects raw data: salt + bytecode
        bytes memory deployData = abi.encodePacked(simpleSalt, simpleBytecode);
        (bool success, bytes memory returnData) = NICK_FACTORY.call(deployData);

        if (success) {
            // Nick's factory returns the deployed address directly in return data
            address deployedAddr = address(uint160(uint256(bytes32(returnData))));
            console.log("SUCCESS: SimpleDummy deployed at:", deployedAddr);

            // Check if contract has code
            uint256 codeSize;
            assembly {
                codeSize := extcodesize(deployedAddr)
            }
            console.log("Code size:", codeSize);

            if (codeSize > 0) {
                SimpleDummy simple = SimpleDummy(deployedAddr);
                uint256 val = simple.getValue();
                console.log("Contract value:", val);
            }
        } else {
            console.log("FAILED: SimpleDummy deployment failed");
        }

        // Test 2: Deploy contract with simple constructor
        console.log("\n--- Test 2: DummyContract (with constructor) ---");
        bytes memory dummyBytecode = abi.encodePacked(
            type(DummyContract).creationCode,
            abi.encode(123) // constructor argument
        );
        bytes32 dummySalt = keccak256("DummyContract_v1");

        console.log("Bytecode length:", dummyBytecode.length);

        // Nick's factory expects raw data: salt + bytecode
        bytes memory deployData2 = abi.encodePacked(dummySalt, dummyBytecode);
        (bool success2, bytes memory returnData2) = NICK_FACTORY.call(deployData2);

        if (success2) {
            // Nick's factory returns the deployed address directly in return data
            address deployedAddr = address(uint160(uint256(bytes32(returnData2))));
            console.log("SUCCESS: DummyContract deployed at:", deployedAddr);

            // Check if contract has code
            uint256 codeSize;
            assembly {
                codeSize := extcodesize(deployedAddr)
            }
            console.log("Code size:", codeSize);

            if (codeSize > 0) {
                DummyContract dummy = DummyContract(deployedAddr);
                uint256 val = dummy.getValue();
                console.log("Contract value:", val);
            }
        } else {
            console.log("FAILED: DummyContract deployment failed");
        }

        // Test 3: Direct CREATE2 for comparison
        console.log("\n--- Test 3: Direct CREATE2 (for comparison) ---");
        address directAddr;
        assembly {
            directAddr := create2(0, add(simpleBytecode, 0x20), mload(simpleBytecode), simpleSalt)
        }
        console.log("Direct CREATE2 deployed at:", directAddr);

        uint256 directCodeSize;
        assembly {
            directCodeSize := extcodesize(directAddr)
        }
        console.log("Direct CREATE2 code size:", directCodeSize);

        vm.stopBroadcast();
    }
}
