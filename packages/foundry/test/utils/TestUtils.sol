// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PX} from "../../src/PX.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title TestUtils
 * @dev Utility functions for testing, equivalent to utils.js from Hardhat tests
 */
library TestUtils {
    /**
     * @dev Generate array of numbers from 0 to n-1
     * @param n Length of array
     * @return Array of numbers [0, 1, 2, ..., n-1]
     */
    function range(uint256 n) internal pure returns (uint256[] memory) {
        uint256[] memory result = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            result[i] = i;
        }
        return result;
    }

    /**
     * @dev Shuffle an array using Fisher-Yates algorithm
     * @param array Array to shuffle
     * @return Shuffled array
     */
    function shuffle(uint256[] memory array) internal view returns (uint256[] memory) {
        for (uint256 i = array.length - 1; i > 0; i--) {
            uint256 j = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, i))) % (i + 1);
            (array[i], array[j]) = (array[j], array[i]);
        }
        return array;
    }

    /**
     * @dev Get random element from array
     * @param array Array to pick from
     * @return Random element from array
     */
    function randFromArray(uint256[] memory array) internal view returns (uint256) {
        require(array.length > 0, "Array is empty");
        uint256 index = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao))) % array.length;
        return array[index];
    }

    /**
     * @dev Get random address from array of addresses
     * @param addresses Array of addresses
     * @return Random address from array
     */
    function randFromArray(address[] memory addresses) internal view returns (address) {
        require(addresses.length > 0, "Array is empty");
        uint256 index = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao))) % addresses.length;
        return addresses[index];
    }

    /**
     * @dev Calculate shard index for a token ID (equivalent to getShardIndex in JS tests)
     * @param indexWithOffset Token ID with offset
     * @param indexOffset The offset value
     * @param shardSize Size of each shard
     * @return Shard index (starting from 1)
     */
    function getShardIndex(uint256 indexWithOffset, uint256 indexOffset, uint256 shardSize)
        internal
        pure
        returns (uint256)
    {
        return 1 + ((indexWithOffset - indexOffset) / shardSize);
    }

    /**
     * @dev Configure DOG20 token for locking in PX contract
     * This is a helper function to be called in test setup to maintain backward compatibility
     * @param px The PX contract instance
     * @param dog20Address Address of the DOG20 token
     * @param lockAmount Amount to lock per pixel (usually DOG_TO_PIXEL_SATOSHIS)
     */
    function configureDOG20ForLocking(PX px, address dog20Address, uint256 lockAmount) internal {
        px.setTokenLockAmount(dog20Address, lockAmount);
    }
}
