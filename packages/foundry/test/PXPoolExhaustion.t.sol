// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {PX} from "../src/PX.sol";
import {MockDOG20} from "./mocks/MockDOG20.sol";
import {TestUtils} from "./utils/TestUtils.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// Import custom errors
import {NoPuppersRemaining, TokenNotAvailableForMinting, TokenAlreadyReserved} from "../src/PX.sol";

/**
 * @title PXPoolExhaustionTest
 * @dev Tests that verify the O(1) pool removal fix works correctly by:
 *      1. Reserving tokens scattered across the pool (including high IDs)
 *      2. Minting all remaining tokens until pool is exhausted
 *      3. Verifying no tokens are "orphaned" or unreachable
 */
contract PXPoolExhaustionTest is Test {
    using TestUtils for uint256[];

    // Test constants - reasonable size for comprehensive testing
    uint256 constant MOCK_WIDTH = 50;
    uint256 constant MOCK_HEIGHT = 40;
    uint256 constant MOCK_SUPPLY = MOCK_WIDTH * MOCK_HEIGHT; // 2000 tokens
    string constant MOCK_URI = "ipfs://test/";
    uint256 constant DOG_TO_PIXEL_SATOSHIS = 5523989899 * 10 ** 13;
    uint256 constant INDEX_OFFSET = 1000000;

    PX public px;
    MockDOG20 public dog20;

    address public owner;
    address public admin;
    address public minter;
    address public claimer;

    function setUp() public {
        owner = address(this);
        admin = makeAddr("admin");
        minter = makeAddr("minter");
        claimer = makeAddr("claimer");

        // Deploy contracts
        dog20 = new MockDOG20();

        PX implementation = new PX();
        bytes memory initData = abi.encodeWithSelector(
            PX.__PX_init.selector,
            "Pool Exhaustion Test",
            "PET",
            address(dog20),
            MOCK_URI,
            MOCK_WIDTH,
            MOCK_HEIGHT,
            admin, // fees address
            admin // owner
        );

        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), initData);
        px = PX(address(proxy));

        // Configure DOG20 token for locking
        vm.prank(admin);
        px.setTokenLockAmount(address(dog20), DOG_TO_PIXEL_SATOSHIS);

        // Give users plenty of DOG tokens
        dog20.mint(minter, DOG_TO_PIXEL_SATOSHIS * MOCK_SUPPLY * 2);
        dog20.mint(claimer, DOG_TO_PIXEL_SATOSHIS * MOCK_SUPPLY);

        // Approve PX contract
        vm.prank(minter);
        dog20.approve(address(px), type(uint256).max);

        vm.prank(claimer);
        dog20.approve(address(px), type(uint256).max);
    }

    /**
     * @dev Helper to generate pseudo-random token IDs for reservation
     *      Distributes IDs across the entire range, including high IDs
     */
    function generateRandomTokenIds(uint256 count, uint256 seed) internal pure returns (uint256[] memory) {
        uint256[] memory ids = new uint256[](count);
        uint256 spacing = MOCK_SUPPLY / count;

        for (uint256 i = 0; i < count; i++) {
            // Generate deterministic but scattered IDs
            uint256 baseIndex = i * spacing;
            uint256 offset = uint256(keccak256(abi.encodePacked(seed, i))) % spacing;
            uint256 index = baseIndex + offset;
            if (index >= MOCK_SUPPLY) index = MOCK_SUPPLY - 1;
            ids[i] = INDEX_OFFSET + index;
        }

        return ids;
    }

    /**
     * @dev Helper to mint tokens and return the minted token ID
     */
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
     * @notice Test: Reserve 200 scattered tokens, then exhaust the pool via random minting
     * @dev This is the main test that verifies the O(1) fix works correctly
     */
    function test_ReserveScatteredTokensThenExhaustPool() public {
        uint256 reservationCount = 200;

        console.log("=== Pool Exhaustion Test ===");
        console.log("Total supply:", MOCK_SUPPLY);
        console.log("Reservations:", reservationCount);

        // Generate 200 token IDs scattered across the pool
        // Include some at very high indices to test the orphan fix
        uint256[] memory reservedIds = generateRandomTokenIds(reservationCount, 12345);

        // Verify we have unique IDs (sort and check for duplicates)
        for (uint256 i = 0; i < reservedIds.length; i++) {
            for (uint256 j = i + 1; j < reservedIds.length; j++) {
                require(reservedIds[i] != reservedIds[j], "Duplicate token ID generated");
            }
        }

        // Create recipients array (all go to claimer)
        address[] memory recipients = new address[](reservationCount);
        for (uint256 i = 0; i < reservationCount; i++) {
            recipients[i] = claimer;
        }

        // === Step 1: Reserve tokens while paused ===
        console.log("\nStep 1: Reserving", reservationCount, "tokens...");

        // Process in batches of 50 (contract max is 100)
        uint256 batchSize = 50;
        uint256 totalBatches = (reservationCount + batchSize - 1) / batchSize;

        for (uint256 batch = 0; batch < totalBatches; batch++) {
            uint256 start = batch * batchSize;
            uint256 end = start + batchSize;
            if (end > reservationCount) end = reservationCount;
            uint256 count = end - start;

            uint256[] memory batchIds = new uint256[](count);
            address[] memory batchRecipients = new address[](count);

            for (uint256 i = 0; i < count; i++) {
                batchIds[i] = reservedIds[start + i];
                batchRecipients[i] = recipients[start + i];
            }

            vm.prank(admin);
            px.reserveTokensForMigration(batchIds, batchRecipients);

            if ((batch + 1) % 2 == 0) {
                console.log("  Reserved batch", batch + 1, "/", totalBatches);
            }
        }

        assertEq(px.totalReserved(), reservationCount);
        assertEq(px.puppersRemaining(), MOCK_SUPPLY - reservationCount);
        console.log("  Total reserved:", px.totalReserved());
        console.log("  Puppers remaining:", px.puppersRemaining());

        // === Step 2: Verify all reservations are correct ===
        console.log("\nStep 2: Verifying reservations...");
        for (uint256 i = 0; i < reservationCount; i++) {
            assertTrue(px.isReserved(reservedIds[i]), "Token should be reserved");
            (address reservedFor,) = px.getReservation(reservedIds[i]);
            assertEq(reservedFor, claimer, "Wrong recipient");
        }
        console.log("  All", reservationCount, "reservations verified");

        // === Step 3: Unpause and mint all remaining tokens ===
        console.log("\nStep 3: Unpausing and minting remaining tokens...");
        vm.prank(admin);
        px.unpause();

        uint256 expectedMintable = MOCK_SUPPLY - reservationCount;
        uint256 mintedCount = 0;
        uint256[] memory mintedTokens = new uint256[](expectedMintable);

        console.log("  Expected mintable:", expectedMintable);

        while (px.puppersRemaining() > 0) {
            uint256 tokenId = mintSingle(minter);
            mintedTokens[mintedCount] = tokenId;
            mintedCount++;

            // Progress logging
            if (mintedCount % 500 == 0 || px.puppersRemaining() == 0) {
                console.log("  Minted:", mintedCount, "/ Remaining:", px.puppersRemaining());
            }
        }

        console.log("  Total minted:", mintedCount);
        assertEq(mintedCount, expectedMintable, "Should mint exactly expectedMintable tokens");
        assertEq(px.puppersRemaining(), 0, "No puppers should remain");

        // === Step 4: Verify minted tokens don't overlap with reserved tokens ===
        console.log("\nStep 4: Verifying no overlap between minted and reserved tokens...");
        for (uint256 i = 0; i < mintedCount; i++) {
            for (uint256 j = 0; j < reservationCount; j++) {
                require(mintedTokens[i] != reservedIds[j], "Minted token overlaps with reserved");
            }
        }
        console.log("  No overlap detected");

        // === Step 5: Verify minted tokens are unique ===
        console.log("\nStep 5: Verifying all minted tokens are unique...");
        for (uint256 i = 0; i < mintedCount; i++) {
            for (uint256 j = i + 1; j < mintedCount; j++) {
                require(mintedTokens[i] != mintedTokens[j], "Duplicate minted token");
            }
        }
        console.log("  All minted tokens are unique");

        // === Step 6: Verify pool is exhausted ===
        console.log("\nStep 6: Verifying pool is exhausted...");
        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(NoPuppersRemaining.selector));
        px.mintPuppers(1, address(dog20));
        console.log("  Pool correctly exhausted");

        // === Step 7: Verify reserved tokens are still claimable ===
        console.log("\nStep 7: Verifying reserved tokens are still claimable...");

        // Set burn flags for all reserved tokens (in batches)
        for (uint256 batch = 0; batch < totalBatches; batch++) {
            uint256 start = batch * batchSize;
            uint256 end = start + batchSize;
            if (end > reservationCount) end = reservationCount;
            uint256 count = end - start;

            uint256[] memory batchIds = new uint256[](count);
            bool[] memory burnFlags = new bool[](count);

            for (uint256 i = 0; i < count; i++) {
                batchIds[i] = reservedIds[start + i];
                burnFlags[i] = true;
            }

            vm.prank(admin);
            px.setBurnFlags(batchIds, burnFlags);
        }

        // Claim a few reserved tokens
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(claimer);
            px.claimReservedToken(reservedIds[i], address(dog20));
            assertEq(px.ownerOf(reservedIds[i]), claimer);
        }
        console.log("  Claimed 5 reserved tokens successfully");

        console.log("\n=== TEST PASSED ===");
    }

    /**
     * @notice Test: Reserve tokens at high indices specifically (edge case for orphan fix)
     */
    function test_ReserveHighIndexTokensThenExhaustPool() public {
        uint256 reservationCount = 50;

        console.log("=== High Index Reservation Test ===");

        // Reserve tokens specifically at the END of the pool (high indices)
        // These are the tokens most likely to become orphaned without the fix
        uint256[] memory reservedIds = new uint256[](reservationCount);
        for (uint256 i = 0; i < reservationCount; i++) {
            // Put tokens in the last portion of the supply
            reservedIds[i] = INDEX_OFFSET + MOCK_SUPPLY - reservationCount + i;
        }

        address[] memory recipients = new address[](reservationCount);
        for (uint256 i = 0; i < reservationCount; i++) {
            recipients[i] = claimer;
        }

        // Reserve while paused
        vm.prank(admin);
        px.reserveTokensForMigration(reservedIds, recipients);

        console.log(
            "Reserved %s tokens at indices %s to %s", reservationCount, MOCK_SUPPLY - reservationCount, MOCK_SUPPLY - 1
        );

        // Unpause and mint ALL remaining tokens
        vm.prank(admin);
        px.unpause();

        uint256 expectedMintable = MOCK_SUPPLY - reservationCount;
        uint256 mintedCount = 0;

        while (px.puppersRemaining() > 0) {
            mintSingle(minter);
            mintedCount++;

            if (mintedCount % 500 == 0) {
                console.log("  Minted:", mintedCount, "/ Remaining:", px.puppersRemaining());
            }
        }

        console.log("Total minted:", mintedCount);
        assertEq(mintedCount, expectedMintable);
        assertEq(px.puppersRemaining(), 0);

        // Verify reserved tokens are still reserved and claimable
        for (uint256 i = 0; i < reservationCount; i++) {
            assertTrue(px.isReserved(reservedIds[i]));
        }

        console.log("=== TEST PASSED ===");
    }

    /**
     * @notice Test: Interleaved reservations and minting
     */
    function test_InterleavedReservationsAndMinting() public {
        console.log("=== Interleaved Reservations and Minting Test ===");

        uint256 totalReserved = 0;
        uint256 totalMinted = 0;

        // Contract starts paused; unpause to begin
        vm.prank(admin);
        px.unpause();

        // Do 10 rounds of: reserve some, mint some
        for (uint256 round = 0; round < 10; round++) {
            uint256 toReserve = 10;
            uint256 toMint = 15;

            // Check if we can still reserve
            if (px.puppersRemaining() >= toReserve && totalReserved + toReserve <= MOCK_SUPPLY / 2) {
                // Need to pause for reservations
                vm.prank(admin);
                px.pause();

                // Generate unique token IDs for this round
                uint256[] memory roundIds = new uint256[](toReserve);
                address[] memory roundRecipients = new address[](toReserve);

                for (uint256 i = 0; i < toReserve; i++) {
                    // Pick random IDs from remaining pool
                    uint256 idx =
                        uint256(keccak256(abi.encodePacked(round, i, block.timestamp))) % px.puppersRemaining();
                    roundIds[i] = INDEX_OFFSET + idx;
                    roundRecipients[i] = claimer;
                }

                // Some IDs might conflict; skip if already reserved
                uint256 validCount = 0;
                for (uint256 i = 0; i < toReserve; i++) {
                    if (!px.isReserved(roundIds[i])) {
                        roundIds[validCount] = roundIds[i];
                        roundRecipients[validCount] = roundRecipients[i];
                        validCount++;
                    }
                }

                if (validCount > 0) {
                    uint256[] memory validIds = new uint256[](validCount);
                    address[] memory validRecipients = new address[](validCount);
                    for (uint256 i = 0; i < validCount; i++) {
                        validIds[i] = roundIds[i];
                        validRecipients[i] = roundRecipients[i];
                    }

                    vm.prank(admin);
                    try px.reserveTokensForMigration(validIds, validRecipients) {
                        totalReserved += validCount;
                    } catch {
                        // Some might fail if already minted/reserved; that's ok
                    }
                }

                vm.prank(admin);
                px.unpause();
            }

            // Now mint some
            for (uint256 i = 0; i < toMint && px.puppersRemaining() > 0; i++) {
                mintSingle(minter);
                totalMinted++;
            }

            console.log("Round %s complete", round + 1);
            console.log("  Reserved: %s, Minted: %s, Remaining: %s", totalReserved, totalMinted, px.puppersRemaining());
        }

        // Exhaust remaining pool
        console.log("\nExhausting remaining pool...");
        while (px.puppersRemaining() > 0) {
            mintSingle(minter);
            totalMinted++;
        }

        console.log("Final: Minted", totalMinted, "Reserved", totalReserved);
        assertEq(px.puppersRemaining(), 0);

        console.log("=== TEST PASSED ===");
    }

    /**
     * @notice Test: Verify O(1) gas cost for pool removal
     */
    function test_PoolRemovalGasIsConstant() public {
        console.log("=== Gas Cost Test for Pool Removal ===");

        // Reserve tokens at beginning, middle, and end of pool
        uint256[] memory testPositions = new uint256[](3);
        testPositions[0] = INDEX_OFFSET + 10; // Near start
        testPositions[1] = INDEX_OFFSET + MOCK_SUPPLY / 2; // Middle
        testPositions[2] = INDEX_OFFSET + MOCK_SUPPLY - 10; // Near end

        address[] memory recipients = new address[](1);
        recipients[0] = claimer;

        uint256[] memory gasCosts = new uint256[](3);

        for (uint256 i = 0; i < 3; i++) {
            uint256[] memory singleId = new uint256[](1);
            singleId[0] = testPositions[i];

            uint256 gasBefore = gasleft();
            vm.prank(admin);
            px.reserveTokensForMigration(singleId, recipients);
            uint256 gasAfter = gasleft();

            gasCosts[i] = gasBefore - gasAfter;
            console.log("Gas for token at index", testPositions[i] - INDEX_OFFSET, ":", gasCosts[i]);
        }

        // Gas costs should be roughly similar (within 20% of each other)
        // This verifies O(1) behavior
        uint256 maxGas = gasCosts[0];
        uint256 minGas = gasCosts[0];
        for (uint256 i = 1; i < 3; i++) {
            if (gasCosts[i] > maxGas) maxGas = gasCosts[i];
            if (gasCosts[i] < minGas) minGas = gasCosts[i];
        }

        // Allow 50% variance (generous, but should catch O(n) behavior)
        uint256 variance = (maxGas - minGas) * 100 / minGas;
        console.log("Gas variance:", variance, "%");
        assertTrue(variance < 50, "Gas variance too high - may indicate O(n) behavior");

        console.log("=== TEST PASSED ===");
    }

    /**
     * @notice Test: Edge case - reserve ALL tokens (no random minting possible)
     */
    function test_ReserveAllTokens() public {
        console.log("=== Reserve All Tokens Test ===");

        // Reserve all tokens in batches
        uint256 batchSize = 50;
        uint256 totalBatches = (MOCK_SUPPLY + batchSize - 1) / batchSize;

        for (uint256 batch = 0; batch < totalBatches; batch++) {
            uint256 start = batch * batchSize;
            uint256 end = start + batchSize;
            if (end > MOCK_SUPPLY) end = MOCK_SUPPLY;
            uint256 count = end - start;

            uint256[] memory batchIds = new uint256[](count);
            address[] memory batchRecipients = new address[](count);

            for (uint256 i = 0; i < count; i++) {
                batchIds[i] = INDEX_OFFSET + start + i;
                batchRecipients[i] = claimer;
            }

            vm.prank(admin);
            px.reserveTokensForMigration(batchIds, batchRecipients);

            if ((batch + 1) % 10 == 0) {
                console.log("Reserved batch", batch + 1, "/", totalBatches);
            }
        }

        assertEq(px.totalReserved(), MOCK_SUPPLY);
        assertEq(px.puppersRemaining(), 0);
        console.log("All", MOCK_SUPPLY, "tokens reserved");

        // Unpause - random minting should fail
        vm.prank(admin);
        px.unpause();

        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(NoPuppersRemaining.selector));
        px.mintPuppers(1, address(dog20));

        console.log("Random minting correctly blocked");
        console.log("=== TEST PASSED ===");
    }

    /**
     * @notice Test: Reserve specific tokens that would be at natural index (never moved)
     */
    function test_ReserveTokensAtNaturalIndex() public {
        console.log("=== Natural Index Reservation Test ===");

        // These tokens have never been moved, so pupperToIndex[tokenId] == 0
        // and indexToPupper[tokenId] == 0 (MAGIC_NULL)
        uint256[] memory tokenIds = new uint256[](5);
        tokenIds[0] = INDEX_OFFSET + 0; // First token
        tokenIds[1] = INDEX_OFFSET + 100;
        tokenIds[2] = INDEX_OFFSET + 500;
        tokenIds[3] = INDEX_OFFSET + 1000;
        tokenIds[4] = INDEX_OFFSET + MOCK_SUPPLY - 1; // Last token

        address[] memory recipients = new address[](5);
        for (uint256 i = 0; i < 5; i++) {
            recipients[i] = claimer;
        }

        // Reserve these "natural" tokens
        vm.prank(admin);
        px.reserveTokensForMigration(tokenIds, recipients);

        console.log("Reserved 5 tokens at natural indices");

        // Verify reservations
        for (uint256 i = 0; i < 5; i++) {
            assertTrue(px.isReserved(tokenIds[i]));
        }

        // Unpause and do some random minting
        vm.prank(admin);
        px.unpause();

        for (uint256 i = 0; i < 100; i++) {
            uint256 tokenId = mintSingle(minter);
            // Minted token should NOT be any of the reserved ones
            for (uint256 j = 0; j < 5; j++) {
                require(tokenId != tokenIds[j], "Minted reserved token!");
            }
        }

        console.log("Minted 100 tokens without hitting reserved tokens");

        // Reserved tokens should still be reserved
        for (uint256 i = 0; i < 5; i++) {
            assertTrue(px.isReserved(tokenIds[i]));
        }

        console.log("=== TEST PASSED ===");
    }

    /**
     * @notice Fuzz test: Random reservation count and random minting
     */
    function testFuzz_RandomReservationAndMinting(uint8 reservePercent, uint8 seed) public {
        // Limit reserve percentage to 0-80% to leave room for minting
        reservePercent = reservePercent % 81;
        uint256 toReserve = (MOCK_SUPPLY * reservePercent) / 100;
        if (toReserve == 0) toReserve = 1;
        if (toReserve > 500) toReserve = 500; // Cap for test speed

        console.log("Fuzz: reserving %s tokens (%s%%)", toReserve, reservePercent);

        // Generate random token IDs
        uint256[] memory reservedIds = new uint256[](toReserve);
        address[] memory recipients = new address[](toReserve);

        for (uint256 i = 0; i < toReserve; i++) {
            uint256 idx = uint256(keccak256(abi.encodePacked(seed, i))) % MOCK_SUPPLY;
            reservedIds[i] = INDEX_OFFSET + idx;
            recipients[i] = claimer;
        }

        // Deduplicate IDs
        uint256 uniqueCount = 0;
        for (uint256 i = 0; i < toReserve; i++) {
            bool isDuplicate = false;
            for (uint256 j = 0; j < uniqueCount; j++) {
                if (reservedIds[i] == reservedIds[j]) {
                    isDuplicate = true;
                    break;
                }
            }
            if (!isDuplicate) {
                reservedIds[uniqueCount] = reservedIds[i];
                recipients[uniqueCount] = recipients[i];
                uniqueCount++;
            }
        }

        // Resize arrays
        uint256[] memory uniqueIds = new uint256[](uniqueCount);
        address[] memory uniqueRecipients = new address[](uniqueCount);
        for (uint256 i = 0; i < uniqueCount; i++) {
            uniqueIds[i] = reservedIds[i];
            uniqueRecipients[i] = recipients[i];
        }

        // Reserve in batches
        uint256 batchSize = 50;
        for (uint256 start = 0; start < uniqueCount; start += batchSize) {
            uint256 end = start + batchSize;
            if (end > uniqueCount) end = uniqueCount;
            uint256 count = end - start;

            uint256[] memory batchIds = new uint256[](count);
            address[] memory batchRecipients = new address[](count);
            for (uint256 i = 0; i < count; i++) {
                batchIds[i] = uniqueIds[start + i];
                batchRecipients[i] = uniqueRecipients[start + i];
            }

            vm.prank(admin);
            px.reserveTokensForMigration(batchIds, batchRecipients);
        }

        // Unpause and exhaust pool
        vm.prank(admin);
        px.unpause();

        uint256 mintedCount = 0;
        while (px.puppersRemaining() > 0) {
            mintSingle(minter);
            mintedCount++;
        }

        console.log("  Reserved:", uniqueCount, "Minted:", mintedCount);
        assertEq(mintedCount + uniqueCount, MOCK_SUPPLY);
    }
}
