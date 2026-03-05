// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {PXV3} from "../src/PXV3.sol";
import {MockDOG20} from "./mocks/MockDOG20.sol";
import {TestUtils} from "./utils/TestUtils.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// Import custom errors
import {NoPuppersRemaining, NoLockFoundForPixel, PupperIsNotYours} from "../src/PXV3.sol";

/**
 * @title PXStressTest
 * @dev Stress tests and edge cases for PX token, equivalent to the more intensive Hardhat tests
 */
contract PXStressTest is Test {
    using TestUtils for uint256[];
    using TestUtils for address[];

    // Reduced test constants for faster execution
    uint256 constant MOCK_WIDTH = 10; // Very small for stress testing
    uint256 constant MOCK_HEIGHT = 10;
    uint256 constant MOCK_SUPPLY = MOCK_WIDTH * MOCK_HEIGHT; // 100 tokens
    string constant MOCK_URI = "ipfs://dog-repo/";
    uint256 constant DOG_TO_PIXEL_SATOSHIS = 5523989899 * 10 ** 13;
    uint256 constant INDEX_OFFSET = 1000000;
    uint256 constant SHARD_SIZE = 5000;

    PXV3 public px;
    MockDOG20 public dog20;

    address public owner;
    address public addr1;
    address public addr2;
    address public feesAccountDev;
    address[] public mockAddresses;

    function setUp() public {
        owner = address(this);
        addr1 = makeAddr("addr1");
        addr2 = makeAddr("addr2");
        feesAccountDev = makeAddr("feesAccountDev");

        // Create test addresses for DOG20 distribution
        mockAddresses = new address[](4);
        mockAddresses[0] = owner;
        mockAddresses[1] = addr1;
        mockAddresses[2] = addr2;
        mockAddresses[3] = makeAddr("addr3");

        // Deploy contracts
        dog20 = new MockDOG20();
        dog20.initialize(mockAddresses, DOG_TO_PIXEL_SATOSHIS * MOCK_SUPPLY * 10); // Extra tokens for stress testing

        PXV3 implementation = new PXV3();
        bytes memory initData = abi.encodeWithSelector(
            PXV3.__PX_init.selector,
            "STRESS TEST PX",
            "SPX",
            address(dog20),
            MOCK_URI,
            MOCK_WIDTH,
            MOCK_HEIGHT,
            feesAccountDev,
            address(this) // owner
        );

        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), initData);
        px = PXV3(address(proxy));

        // Contract starts paused, so unpause it for stress testing
        px.unpause();
        px.startMinting();

        // Configure DOG20 token for locking (required for new token lock system)
        px.setTokenLockAmount(address(dog20), DOG_TO_PIXEL_SATOSHIS);
    }

    // Helper function to mint with automatic approval
    function mintPuppers(address user, uint256 qty) internal returns (uint256[] memory) {
        vm.prank(user);
        dog20.approve(address(px), DOG_TO_PIXEL_SATOSHIS * qty);

        vm.recordLogs();
        vm.prank(user);
        px.mintPuppers(qty, address(dog20));

        // Extract all token IDs from Transfer events
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256[] memory tokenIds = new uint256[](qty);
        uint256 tokenCount = 0;

        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].topics.length == 4 && logs[i].topics[0] == keccak256("Transfer(address,address,uint256)")
                    && logs[i].emitter != address(dog20)
            ) {
                address from = address(uint160(uint256(logs[i].topics[1])));
                if (from == address(0)) {
                    // Mint event (from zero address)
                    tokenIds[tokenCount] = uint256(logs[i].topics[3]);
                    tokenCount++;
                }
            }
        }

        // Resize array to actual token count
        uint256[] memory result = new uint256[](tokenCount);
        for (uint256 i = 0; i < tokenCount; i++) {
            result[i] = tokenIds[i];
        }

        return result;
    }

    // Test: Mint entire supply sequentially
    function test_MintEntireSupply() public {
        console.log("Testing sequential minting of entire supply...");
        uint256 count = 0;

        while (px.puppersRemaining() > 0) {
            mintPuppers(addr1, 1);
            count++;

            if (count % 25 == 0) {
                uint256 progress = (count * 100) / MOCK_SUPPLY;
                console.log("Progress:", progress, "%");
            }
        }

        console.log("Minted", count, "tokens");
        assertEq(count, MOCK_SUPPLY);
        assertEq(px.puppersRemaining(), 0);

        // Try to mint one more (should fail)
        vm.prank(addr1);
        dog20.approve(address(px), DOG_TO_PIXEL_SATOSHIS);

        vm.prank(addr1);
        vm.expectRevert(abi.encodeWithSelector(NoPuppersRemaining.selector));
        px.mintPuppers(1, address(dog20));
    }

    // Test: Burn entire supply in random order
    function test_BurnEntireSupplyRandomOrder() public {
        // First mint entire supply
        uint256[] memory allTokens = new uint256[](MOCK_SUPPLY);
        uint256 tokenIndex = 0;

        while (px.puppersRemaining() > 0) {
            uint256[] memory newTokens = mintPuppers(addr1, 1);
            allTokens[tokenIndex] = newTokens[0];
            tokenIndex++;
        }

        console.log("Minted all tokens, now burning in random order...");

        // Shuffle the token array
        allTokens = TestUtils.shuffle(allTokens);

        // Burn all tokens
        for (uint256 i = 0; i < allTokens.length; i++) {
            uint256 tokenId = allTokens[i];
            address tokenOwner = px.ownerOf(tokenId);

            uint256[] memory tokensToBurn = new uint256[](1);
            tokensToBurn[0] = tokenId;

            vm.prank(tokenOwner);
            px.burnPuppers(tokensToBurn);

            // Try to burn again (should fail)
            vm.prank(tokenOwner);
            vm.expectRevert(abi.encodeWithSelector(NoLockFoundForPixel.selector));
            px.burnPuppers(tokensToBurn);

            if ((i + 1) % 25 == 0) {
                uint256 progress = ((i + 1) * 100) / allTokens.length;
                console.log("Burn progress:", progress, "%");
            }
        }

        assertEq(px.puppersRemaining(), MOCK_SUPPLY);
        console.log("Successfully burned all tokens");
    }

    // Test: Random mint/burn cycles
    function test_RandomMintBurnCycles() public {
        uint256 cycles = MOCK_SUPPLY * 2; // Do more operations than total supply
        uint256 divider = 3; // Controls mint vs burn probability

        for (uint256 i = 0; i < cycles; i++) {
            uint256 remaining = px.puppersRemaining();
            uint256 randomValue = uint256(keccak256(abi.encodePacked(block.timestamp, i))) % 100;

            // Adjust divider occasionally
            if (i % 10 == 0) {
                divider = (uint256(keccak256(abi.encodePacked(block.prevrandao, i))) % 7) + 2;
            }

            if (randomValue % divider == 0) {
                // Try to mint
                if (remaining == 0) {
                    // Should fail
                    vm.prank(addr1);
                    dog20.approve(address(px), DOG_TO_PIXEL_SATOSHIS);

                    vm.prank(addr1);
                    vm.expectRevert(abi.encodeWithSelector(NoPuppersRemaining.selector));
                    px.mintPuppers(1, address(dog20));
                } else {
                    // Should succeed
                    mintPuppers(addr1, 1);
                }
            } else {
                // Try to burn random token
                uint256 randomTokenId =
                    (uint256(keccak256(abi.encodePacked(block.timestamp, i, "token"))) % MOCK_SUPPLY) + INDEX_OFFSET;

                try px.ownerOf(randomTokenId) returns (address tokenOwner) {
                    // Token exists, try to burn
                    uint256[] memory tokensToBurn = new uint256[](1);
                    tokensToBurn[0] = randomTokenId;

                    if (tokenOwner == addr1) {
                        // addr1 owns it, burn should succeed
                        vm.prank(addr1);
                        px.burnPuppers(tokensToBurn);
                    } else {
                        // addr1 doesn't own it, should fail
                        vm.prank(addr1);
                        vm.expectRevert(abi.encodeWithSelector(PupperIsNotYours.selector));
                        px.burnPuppers(tokensToBurn);
                    }
                } catch {
                    // Token doesn't exist, burn should fail
                    uint256[] memory tokensToBurn = new uint256[](1);
                    tokensToBurn[0] = randomTokenId;

                    vm.prank(addr1);
                    vm.expectRevert(abi.encodeWithSelector(NoLockFoundForPixel.selector));
                    px.burnPuppers(tokensToBurn);
                }
            }

            if (i % (cycles / 20) == 0) {
                uint256 progress = (i * 100) / cycles;
                console.log("Cycle progress:", progress, "%, remaining puppers:", px.puppersRemaining());
            }
        }

        console.log("Completed", cycles, "random mint/burn cycles");
    }

    // Test: Multiple users minting simultaneously
    function test_MultiUserConcurrentMinting() public {
        address[] memory users = new address[](4);
        users[0] = addr1;
        users[1] = addr2;
        users[2] = makeAddr("user3");
        users[3] = makeAddr("user4");

        // Give all users DOG tokens
        for (uint256 i = 0; i < users.length; i++) {
            vm.prank(owner);
            dog20.mint(users[i], DOG_TO_PIXEL_SATOSHIS * 30);
        }

        uint256[] memory userBalances = new uint256[](users.length);

        // Each user mints in sequence
        for (uint256 round = 0; round < 20; round++) {
            for (uint256 userIndex = 0; userIndex < users.length; userIndex++) {
                if (px.puppersRemaining() > 0) {
                    mintPuppers(users[userIndex], 1);
                    userBalances[userIndex]++;
                }
            }
        }

        // Verify all balances
        for (uint256 i = 0; i < users.length; i++) {
            assertEq(px.balanceOf(users[i]), userBalances[i]);
            console.log("User %s minted %s tokens", vm.toString(i), vm.toString(userBalances[i]));
        }
    }

    // Test: Large batch operations
    function test_LargeBatchBurn() public {
        uint256 batchSize = 20;
        require(batchSize <= MOCK_SUPPLY, "Batch size too large");

        // Mint batch
        uint256[] memory tokens = new uint256[](batchSize);
        for (uint256 i = 0; i < batchSize; i++) {
            uint256[] memory newTokens = mintPuppers(addr1, 1);
            tokens[i] = newTokens[0];
        }

        // Burn entire batch at once
        vm.prank(addr1);
        px.burnPuppers(tokens);

        assertEq(px.balanceOf(addr1), 0);
        assertEq(px.puppersRemaining(), MOCK_SUPPLY);
    }

    // Test: Edge case - burn non-existent token
    function test_BurnNonExistentToken() public {
        uint256 nonExistentToken = INDEX_OFFSET + MOCK_SUPPLY + 1000; // Way outside valid range
        uint256[] memory tokens = new uint256[](1);
        tokens[0] = nonExistentToken;

        vm.prank(addr1);
        vm.expectRevert(abi.encodeWithSelector(NoLockFoundForPixel.selector));
        px.burnPuppers(tokens);
    }

    // Test: Edge case - burn magic null token
    function test_BurnMagicNullToken() public {
        uint256[] memory tokens = new uint256[](1);
        tokens[0] = 0; // MAGIC_NULL

        vm.prank(addr1);
        vm.expectRevert(abi.encodeWithSelector(NoLockFoundForPixel.selector));
        px.burnPuppers(tokens);
    }

    // Test: Transfer and then burn
    function test_TransferThenBurn() public {
        uint256[] memory tokens = mintPuppers(addr1, 1);
        uint256 tokenId = tokens[0];

        // Transfer from addr1 to addr2
        vm.prank(addr1);
        px.transferFrom(addr1, addr2, tokenId);

        // addr1 can no longer burn it
        uint256[] memory tokensToBurn = new uint256[](1);
        tokensToBurn[0] = tokenId;

        vm.prank(addr1);
        vm.expectRevert(abi.encodeWithSelector(PupperIsNotYours.selector));
        px.burnPuppers(tokensToBurn);

        // addr2 can burn it
        vm.prank(addr2);
        px.burnPuppers(tokensToBurn);
    }

    // Test: Gas efficiency for random operations
    function test_GasEfficiency() public {
        uint256 mintGas = 0;
        uint256 burnGas = 0;
        uint256 iterations = 5;

        for (uint256 i = 0; i < iterations; i++) {
            // Measure mint gas
            uint256 gasBeforeMint = gasleft();
            uint256[] memory tokens = mintPuppers(addr1, 1);
            uint256 gasAfterMint = gasleft();
            mintGas += gasBeforeMint - gasAfterMint;

            // Measure burn gas
            uint256 gasBeforeBurn = gasleft();
            vm.prank(addr1);
            px.burnPuppers(tokens);
            uint256 gasAfterBurn = gasleft();
            burnGas += gasBeforeBurn - gasAfterBurn;
        }

        uint256 avgMintGas = mintGas / iterations;
        uint256 avgBurnGas = burnGas / iterations;

        console.log("Average mint gas:", avgMintGas);
        console.log("Average burn gas:", avgBurnGas);

        // Gas should be reasonable
        assertLt(avgMintGas, 300000, "Mint gas too high");
        assertLt(avgBurnGas, 200000, "Burn gas too high");
    }

    // Test: Supply invariants
    function test_SupplyInvariants() public {
        uint256 initialSupply = px.totalSupply();
        uint256 initialRemaining = px.puppersRemaining();

        assertEq(initialSupply, MOCK_SUPPLY);
        assertEq(initialRemaining, MOCK_SUPPLY);

        // Mint some tokens
        uint256[] memory tokens1 = mintPuppers(addr1, 3);
        assertEq(px.totalSupply(), MOCK_SUPPLY); // Total supply never changes
        assertEq(px.puppersRemaining(), MOCK_SUPPLY - 3);

        // Burn some tokens
        uint256[] memory tokensToBurn = new uint256[](2);
        tokensToBurn[0] = tokens1[0];
        tokensToBurn[1] = tokens1[1];

        vm.prank(addr1);
        px.burnPuppers(tokensToBurn);

        assertEq(px.totalSupply(), MOCK_SUPPLY); // Total supply still unchanged
        assertEq(px.puppersRemaining(), MOCK_SUPPLY - 1); // Only 1 token remains minted

        // Mint more
        uint256[] memory tokens2 = mintPuppers(addr2, 2);
        assertEq(px.puppersRemaining(), MOCK_SUPPLY - 3); // 3 tokens minted total

        // Log the tokens to verify minting worked and use the variable
        console.log("Additional tokens minted:", tokens2.length);
        console.log("Token IDs:", tokens2[0], "and", tokens2[1]);

        // Total supply should always equal puppersRemaining + currently minted tokens
        uint256 currentlyMinted = MOCK_SUPPLY - px.puppersRemaining();
        assertEq(px.totalSupply(), px.puppersRemaining() + currentlyMinted);
    }

    // Test: Burn returns 100% to user, 0% to dev (no fee in V3)
    function test_FeeDistributionAccuracy() public {
        uint256[] memory tokens = mintPuppers(addr1, 1);

        uint256 devBalanceBefore = dog20.balanceOf(feesAccountDev);
        uint256 userBalanceBefore = dog20.balanceOf(addr1);

        vm.prank(addr1);
        px.burnPuppers(tokens);

        // V3: 100% to user, 0% to dev
        assertEq(dog20.balanceOf(feesAccountDev), devBalanceBefore);
        assertEq(dog20.balanceOf(addr1), userBalanceBefore + DOG_TO_PIXEL_SATOSHIS);
    }
}
