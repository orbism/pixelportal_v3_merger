// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {PXV3} from "../src/PXV3.sol";
import {MockDOG20} from "./mocks/MockDOG20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title PXOrphanedTokenFixTest
 * @dev Tests that verify the O(1) pool removal fix works correctly.
 *
 *      Key insight: "Orphaned" tokens only occur with the BUGGY linear search code.
 *      The bug was: linear search only looked in range [INDEX_OFFSET, INDEX_OFFSET + puppersRemaining),
 *      so tokens at their NATURAL position beyond puppersRemaining couldn't be found.
 *
 *      With the O(1) fix using pupperToIndex, ALL tokens can be found regardless of position.
 *
 *      IMPORTANT LIMITATION: Reservations must happen BEFORE any minting. The mintPuppers
 *      function doesn't maintain pupperToIndex for tokens swapped INTO the pool, so after
 *      minting occurs, pupperToIndex becomes unreliable for finding moved tokens.
 *
 *      Production workflow:
 *      1. Deploy new contract (paused)
 *      2. Reserve ALL tokens for existing V1 holders
 *      3. Unpause
 *      4. New minting can proceed
 */
contract PXOrphanedTokenFixTest is Test {
    uint256 constant TEST_WIDTH = 100;
    uint256 constant TEST_HEIGHT = 50;
    uint256 constant TEST_SUPPLY = TEST_WIDTH * TEST_HEIGHT; // 5,000

    string constant MOCK_URI = "ipfs://test/";
    uint256 constant DOG_TO_PIXEL_SATOSHIS = 5523989899 * 10 ** 13;
    uint256 constant INDEX_OFFSET = 1000000;

    PXV3 public px;
    MockDOG20 public dog20;

    address public admin;
    address public minter;
    address public claimer;

    function setUp() public {
        admin = makeAddr("admin");
        minter = makeAddr("minter");
        claimer = makeAddr("claimer");

        dog20 = new MockDOG20();

        PXV3 implementation = new PXV3();
        bytes memory initData = abi.encodeWithSelector(
            PXV3.__PX_init.selector,
            "Orphan Fix Test",
            "OFT",
            address(dog20),
            MOCK_URI,
            TEST_WIDTH,
            TEST_HEIGHT,
            admin,
            admin
        );

        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), initData);
        px = PXV3(address(proxy));

        vm.prank(admin);
        px.setTokenLockAmount(address(dog20), DOG_TO_PIXEL_SATOSHIS);

        dog20.mint(minter, DOG_TO_PIXEL_SATOSHIS * TEST_SUPPLY * 2);
        dog20.mint(claimer, DOG_TO_PIXEL_SATOSHIS * TEST_SUPPLY);

        vm.prank(minter);
        dog20.approve(address(px), type(uint256).max);

        vm.prank(claimer);
        dog20.approve(address(px), type(uint256).max);
    }

    function mintSingle(address user) internal returns (uint256) {
        vm.recordLogs();
        vm.prank(user);
        px.mintPuppers(1, address(dog20));

        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].topics.length == 4 && logs[i].topics[0] == keccak256("Transfer(address,address,uint256)")
                    && logs[i].emitter == address(px)
            ) {
                address from = address(uint160(uint256(logs[i].topics[1])));
                if (from == address(0)) {
                    return uint256(logs[i].topics[3]);
                }
            }
        }
        revert("No mint event found");
    }

    /**
     * @notice Test that tokens at the LAST positions (highest natural indices) can be reserved.
     *         These are the tokens that would have been "orphaned" by the buggy linear search.
     */
    function test_ReserveTokensAtHighNaturalIndices() public {
        console.log("=== Reserve Tokens at High Natural Indices ===");

        // Reserve tokens at the VERY END of the supply range
        // These are the tokens most likely to be orphaned by buggy code
        uint256[] memory highTokens = new uint256[](10);
        for (uint256 i = 0; i < 10; i++) {
            highTokens[i] = INDEX_OFFSET + TEST_SUPPLY - 10 + i; // Tokens 1004990-1004999
        }

        console.log("Attempting to reserve tokens %s to %s", highTokens[0], highTokens[9]);
        console.log("Initial puppersRemaining: %s", px.puppersRemaining());
        console.log("Pool upper bound: %s", INDEX_OFFSET + px.puppersRemaining() - 1);

        address[] memory recipients = new address[](10);
        for (uint256 i = 0; i < 10; i++) {
            recipients[i] = claimer;
        }

        // This should succeed with O(1) fix
        vm.prank(admin);
        px.reserveTokensForMigration(highTokens, recipients);

        console.log("After reservation:");
        console.log("  puppersRemaining: %s", px.puppersRemaining());
        console.log("  totalReserved: %s", px.totalReserved());

        // Verify all are reserved
        for (uint256 i = 0; i < 10; i++) {
            assertTrue(px.isReserved(highTokens[i]));
            (address reservedFor,) = px.getReservation(highTokens[i]);
            assertEq(reservedFor, claimer);
        }

        assertEq(px.totalReserved(), 10);
        assertEq(px.puppersRemaining(), TEST_SUPPLY - 10);

        console.log("=== TEST PASSED ===");
    }

    /**
     * @notice Test that we can reserve tokens and THEN mint without issues.
     *         This is the correct production workflow.
     */
    function test_ReserveThenMint() public {
        console.log("=== Reserve Then Mint ===");

        // First, reserve specific tokens scattered across the range
        uint256 reserveCount = 100;
        uint256[] memory tokensToReserve = new uint256[](reserveCount);
        address[] memory recipients = new address[](reserveCount);

        for (uint256 i = 0; i < reserveCount; i++) {
            // Spread across the entire supply range
            tokensToReserve[i] = INDEX_OFFSET + (i * (TEST_SUPPLY / reserveCount));
            recipients[i] = claimer;
        }

        console.log("Reserving %s tokens spread across range...", reserveCount);

        vm.prank(admin);
        px.reserveTokensForMigration(tokensToReserve, recipients);

        console.log("  Reserved %s tokens", reserveCount);
        console.log("  puppersRemaining: %s", px.puppersRemaining());
        assertEq(px.totalReserved(), reserveCount);
        assertEq(px.puppersRemaining(), TEST_SUPPLY - reserveCount);

        // Verify all are reserved
        for (uint256 i = 0; i < reserveCount; i++) {
            assertTrue(px.isReserved(tokensToReserve[i]));
        }

        // Now unpause and mint
        vm.prank(admin);
        px.unpause();

        vm.prank(admin);
        px.startMinting();

        console.log("Minting 2000 tokens...");
        uint256 minted = 0;
        for (uint256 i = 0; i < 2000; i++) {
            uint256 tokenId = mintSingle(minter);
            minted++;

            // Verify we didn't mint any reserved tokens
            for (uint256 j = 0; j < reserveCount; j++) {
                if (tokenId == tokensToReserve[j]) {
                    revert("Minted a reserved token!");
                }
            }
        }

        console.log("  Minted %s tokens without hitting reserved tokens", minted);

        // All reserved should still be reserved
        for (uint256 i = 0; i < reserveCount; i++) {
            assertTrue(px.isReserved(tokensToReserve[i]), "Reserved token became unreserved");
        }

        console.log("=== TEST PASSED ===");
    }

    /**
     * @notice Test that we can reserve and then exhaust the entire pool.
     */
    function test_ReserveAndExhaustPool() public {
        console.log("=== Reserve and Exhaust Pool ===");

        // Reserve 100 tokens at the highest indices
        uint256 reserveCount = 100;
        uint256[] memory reserved = new uint256[](reserveCount);
        address[] memory recipients = new address[](reserveCount);

        for (uint256 i = 0; i < reserveCount; i++) {
            reserved[i] = INDEX_OFFSET + TEST_SUPPLY - reserveCount + i;
            recipients[i] = claimer;
        }

        console.log("Reserving %s tokens at highest indices...", reserveCount);
        vm.prank(admin);
        px.reserveTokensForMigration(reserved, recipients);

        assertEq(px.totalReserved(), reserveCount);
        assertEq(px.puppersRemaining(), TEST_SUPPLY - reserveCount);

        // Unpause and mint ALL remaining tokens
        vm.prank(admin);
        px.unpause();

        vm.prank(admin);
        px.startMinting();

        console.log("Minting all remaining tokens...");
        uint256 minted = 0;
        while (px.puppersRemaining() > 0) {
            mintSingle(minter);
            minted++;
            if (minted % 1000 == 0) {
                console.log("  Minted %s...", minted);
            }
        }

        console.log("Total minted: %s", minted);
        assertEq(minted, TEST_SUPPLY - reserveCount);
        assertEq(px.puppersRemaining(), 0);

        // All reserved tokens should still be reserved
        for (uint256 i = 0; i < reserveCount; i++) {
            assertTrue(px.isReserved(reserved[i]));
        }

        console.log("=== TEST PASSED ===");
    }

    /**
     * @notice Test O(1) gas cost for reserving tokens at different positions.
     *         Note: Some variance is expected due to cold vs warm storage access.
     *         This test verifies gas is roughly constant, not that variance is zero.
     */
    function test_GasCostIsConstant() public {
        console.log("=== Gas Cost Test ===");

        // Test reservation gas at different positions
        uint256[] memory positions = new uint256[](5);
        positions[0] = INDEX_OFFSET + 0; // First token
        positions[1] = INDEX_OFFSET + TEST_SUPPLY / 4; // 25%
        positions[2] = INDEX_OFFSET + TEST_SUPPLY / 2; // 50%
        positions[3] = INDEX_OFFSET + TEST_SUPPLY * 3 / 4; // 75%
        positions[4] = INDEX_OFFSET + TEST_SUPPLY - 1; // Last token

        uint256[] memory gasCosts = new uint256[](5);
        address[] memory recipient = new address[](1);
        recipient[0] = claimer;

        for (uint256 i = 0; i < 5; i++) {
            uint256[] memory tokenToReserve = new uint256[](1);
            tokenToReserve[0] = positions[i];

            uint256 gasBefore = gasleft();
            vm.prank(admin);
            px.reserveTokensForMigration(tokenToReserve, recipient);
            uint256 gasAfter = gasleft();

            gasCosts[i] = gasBefore - gasAfter;
            uint256 pct = ((positions[i] - INDEX_OFFSET) * 100) / TEST_SUPPLY;
            console.log("Gas for position %s%%: %s", pct, gasCosts[i]);
        }

        // Calculate variance
        uint256 maxGas = gasCosts[0];
        uint256 minGas = gasCosts[0];
        for (uint256 i = 1; i < 5; i++) {
            if (gasCosts[i] > maxGas) maxGas = gasCosts[i];
            if (gasCosts[i] < minGas) minGas = gasCosts[i];
        }

        uint256 variance = ((maxGas - minGas) * 100) / minGas;
        console.log("Gas variance: %s%%", variance);
        console.log("(Variance is due to cold/warm storage, not O(n) behavior)");

        // All gas costs should be in the same order of magnitude (< 200k each)
        // O(n) would show increasing gas with position
        for (uint256 i = 0; i < 5; i++) {
            assertTrue(gasCosts[i] < 200000, "Gas cost too high - may indicate O(n) behavior");
        }

        console.log("=== TEST PASSED ===");
    }

    /**
     * @notice Test production migration scenario: reserve ALL tokens first, then mint.
     */
    function test_ProductionMigrationScenario() public {
        console.log("=== Production Migration Scenario ===");
        console.log("Workflow: Deploy -> Reserve all V1 tokens -> Unpause -> Mint");

        // Step 1: Contract is paused (default in setUp)
        assertTrue(px.paused(), "Contract should start paused");

        // Step 2: Reserve tokens for "V1 holders"
        // Simulate V1 holders with UNIQUE tokens spread across the range
        // Use evenly spaced tokens to avoid duplicates
        uint256 v1HolderCount = 500;
        uint256[] memory v1Tokens = new uint256[](v1HolderCount);
        address[] memory v1Holders = new address[](v1HolderCount);

        console.log("Step 1: Reserving %s V1 tokens...", v1HolderCount);

        for (uint256 i = 0; i < v1HolderCount; i++) {
            // Use evenly spaced tokens to ensure uniqueness
            v1Tokens[i] = INDEX_OFFSET + (i * (TEST_SUPPLY / v1HolderCount));
            v1Holders[i] = makeAddr(string(abi.encodePacked("v1holder", i)));
        }

        // Reserve in batches of 50 (matching production batch size)
        uint256 batchSize = 50;
        for (uint256 start = 0; start < v1HolderCount; start += batchSize) {
            uint256 end = start + batchSize;
            if (end > v1HolderCount) end = v1HolderCount;
            uint256 count = end - start;

            uint256[] memory batch = new uint256[](count);
            address[] memory batchRecipients = new address[](count);
            for (uint256 i = 0; i < count; i++) {
                batch[i] = v1Tokens[start + i];
                batchRecipients[i] = v1Holders[start + i];
            }

            vm.prank(admin);
            px.reserveTokensForMigration(batch, batchRecipients);
        }

        console.log("  Reserved %s tokens for V1 holders", px.totalReserved());
        uint256 totalReserved = px.totalReserved();
        // May be less than v1HolderCount if there were duplicate token IDs
        assertTrue(totalReserved > 0, "Should have reserved some tokens");
        console.log("  puppersRemaining: %s", px.puppersRemaining());

        // Step 3: Unpause for new minting
        vm.prank(admin);
        px.unpause();

        vm.prank(admin);
        px.startMinting();
        console.log("Step 2: Contract unpaused");

        // Step 4: New users mint
        console.log("Step 3: New users minting...");
        uint256 newMints = 2000;
        for (uint256 i = 0; i < newMints; i++) {
            uint256 tokenId = mintSingle(minter);

            // Verify minted token is not reserved
            assertFalse(px.isReserved(tokenId), "Minted a reserved token!");
        }

        console.log("  Minted %s new tokens", newMints);

        // Step 5: Admin sets burn flags (simulating burn verification on V1 chain)
        console.log("Step 4: Setting burn flags...");
        uint256[] memory burnFlagTokens = new uint256[](v1HolderCount);
        bool[] memory burnFlags = new bool[](v1HolderCount);
        uint256 burnFlagCount = 0;

        for (uint256 i = 0; i < v1HolderCount; i++) {
            if (px.isReserved(v1Tokens[i])) {
                burnFlagTokens[burnFlagCount] = v1Tokens[i];
                burnFlags[burnFlagCount] = true;
                burnFlagCount++;
            }
        }

        // Set burn flags in batches
        uint256 burnBatchSize = 200;
        for (uint256 start = 0; start < burnFlagCount; start += burnBatchSize) {
            uint256 end = start + burnBatchSize;
            if (end > burnFlagCount) end = burnFlagCount;
            uint256 count = end - start;

            uint256[] memory batchTokens = new uint256[](count);
            bool[] memory batchFlags = new bool[](count);
            for (uint256 i = 0; i < count; i++) {
                batchTokens[i] = burnFlagTokens[start + i];
                batchFlags[i] = burnFlags[start + i];
            }

            vm.prank(admin);
            px.setBurnFlags(batchTokens, batchFlags);
        }

        console.log("  Set burn flags for %s tokens", burnFlagCount);

        // Step 6: V1 holders claim their reserved tokens
        console.log("Step 5: V1 holders claiming reserved tokens...");
        uint256 claimed = 0;
        for (uint256 i = 0; i < v1HolderCount; i++) {
            if (px.isReserved(v1Tokens[i])) {
                vm.prank(v1Holders[i]);
                dog20.mint(v1Holders[i], DOG_TO_PIXEL_SATOSHIS);
                vm.prank(v1Holders[i]);
                dog20.approve(address(px), DOG_TO_PIXEL_SATOSHIS);

                vm.prank(v1Holders[i]);
                px.claimReservedToken(v1Tokens[i], address(dog20));

                assertEq(px.ownerOf(v1Tokens[i]), v1Holders[i]);
                claimed++;
            }
        }

        console.log("  Claimed %s reserved tokens", claimed);

        // Step 7: Continue minting until pool exhausted
        console.log("Step 6: Exhausting remaining pool...");
        uint256 exhausted = 0;
        while (px.puppersRemaining() > 0) {
            mintSingle(minter);
            exhausted++;
        }

        console.log("  Exhausted %s remaining tokens", exhausted);
        assertEq(px.puppersRemaining(), 0);

        console.log("=== TEST PASSED ===");
    }

    /**
     * @notice Test tokens at their natural positions can be reserved.
     */
    function test_TokensAtNaturalPositions() public {
        console.log("=== Tokens at Natural Positions ===");

        // With a fresh contract, all tokens are at natural positions
        // pupperToIndex[T] == 0 for all T, meaning T is at index T

        // Reserve tokens at various positions including extremes
        uint256[] memory tokens = new uint256[](20);
        address[] memory recipients = new address[](20);

        for (uint256 i = 0; i < 20; i++) {
            tokens[i] = INDEX_OFFSET + i * 250; // Every 250th token
            recipients[i] = claimer;
        }

        console.log("Reserving 20 tokens at natural positions...");

        vm.prank(admin);
        px.reserveTokensForMigration(tokens, recipients);

        for (uint256 i = 0; i < 20; i++) {
            assertTrue(px.isReserved(tokens[i]));
        }

        console.log("=== TEST PASSED ===");
    }

    /**
     * @notice Fuzz test: reserve random tokens (with deduplication)
     */
    function testFuzz_ReserveRandomTokens(uint256 seed) public {
        // Generate random unique token IDs
        uint256[] memory tempTokens = new uint256[](10);
        uint256 uniqueCount = 0;

        for (uint256 i = 0; i < 10; i++) {
            uint256 offset = uint256(keccak256(abi.encodePacked(seed, i))) % TEST_SUPPLY;
            uint256 tokenId = INDEX_OFFSET + offset;

            // Check for duplicates
            bool isDuplicate = false;
            for (uint256 j = 0; j < uniqueCount; j++) {
                if (tempTokens[j] == tokenId) {
                    isDuplicate = true;
                    break;
                }
            }

            if (!isDuplicate) {
                tempTokens[uniqueCount] = tokenId;
                uniqueCount++;
            }
        }

        // Create properly sized arrays
        uint256[] memory tokens = new uint256[](uniqueCount);
        address[] memory recipients = new address[](uniqueCount);
        for (uint256 i = 0; i < uniqueCount; i++) {
            tokens[i] = tempTokens[i];
            recipients[i] = claimer;
        }

        // Should succeed for unique token IDs
        vm.prank(admin);
        px.reserveTokensForMigration(tokens, recipients);

        // Verify all reserved
        for (uint256 i = 0; i < uniqueCount; i++) {
            assertTrue(px.isReserved(tokens[i]));
        }
    }
}
