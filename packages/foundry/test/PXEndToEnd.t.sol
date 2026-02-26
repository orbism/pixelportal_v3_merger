// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {PX} from "../src/PX.sol";
import {MockDOG20} from "./mocks/MockDOG20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// Import custom errors
import {NoPuppersRemaining, NonPositiveQuantity} from "../src/PX.sol";

import {ERC721OwnerQueryForNonexistentToken} from "../src/ERC721CustomUpgradeable.sol";

/**
 * @title PXEndToEnd
 * @dev Comprehensive end-to-end test for PX contract functionality with reservation system
 *
 * Test Scenario:
 * - Deploy PX with 20 total supply (4x5 grid)
 * - Reserve 10 tokens for unique addresses (migration workflow)
 * - Set burn flags and allow users to claim reserved tokens
 * - Mint remaining 10 NFTs normally with various scenarios
 * - Verify counts, ownership, and edge cases throughout
 */
contract PXEndToEnd is Test {
    PX public pxToken;
    MockDOG20 public dogToken;
    ERC1967Proxy public proxy;

    address public owner;
    address public devFeeAddress;

    // Test addresses for various scenarios
    address public minter1;
    address public minter2;
    address public minter3;
    address public minter4;

    // Pre-allocation addresses (10 unique addresses)
    address[10] public preAllocAddresses;

    // Constants for test setup
    uint256 public constant TOTAL_SUPPLY = 20; // 4x5 grid
    uint256 public constant SHIBA_WIDTH = 4;
    uint256 public constant SHIBA_HEIGHT = 5;
    uint256 public constant PRE_ALLOCATED_COUNT = 10;
    uint256 public constant MINTABLE_COUNT = 10;
    uint256 public constant INDEX_OFFSET = 1000000;
    uint256 public constant DOG_TO_PIXEL_SATOSHIS = 5523989899 * 10 ** 13;

    // Events to test
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event TokenReserved(uint256 indexed tokenId, address indexed reservedFor);
    event BurnFlagSet(uint256 indexed tokenId, bool burnConfirmed);
    event ReservedTokenClaimed(uint256 indexed tokenId, address indexed claimer);

    function setUp() public {
        // Set up test addresses
        owner = address(this);
        minter1 = makeAddr("minter1");
        minter2 = makeAddr("minter2");
        minter3 = makeAddr("minter3");
        minter4 = makeAddr("minter4");
        devFeeAddress = makeAddr("devFee");

        // Create 10 unique pre-allocation addresses
        for (uint256 i = 0; i < 10; i++) {
            preAllocAddresses[i] = makeAddr(string(abi.encodePacked("preAlloc", vm.toString(i))));
        }

        // Deploy DOG20 mock token
        dogToken = new MockDOG20();

        // Deploy PX implementation
        PX implementation = new PX();

        // Prepare initialization data
        bytes memory initData = abi.encodeWithSelector(
            PX.__PX_init.selector,
            "Pixel Token",
            "PX",
            address(dogToken),
            "ipfs://test-uri/",
            SHIBA_WIDTH,
            SHIBA_HEIGHT,
            devFeeAddress,
            address(this) // owner
        );

        // Deploy UUPS proxy
        proxy = new ERC1967Proxy(address(implementation), initData);

        // Cast proxy to PX interface
        pxToken = PX(address(proxy));

        // Configure DOG20 token for locking (required for new token lock system)
        pxToken.setTokenLockAmount(address(dogToken), DOG_TO_PIXEL_SATOSHIS);

        // Mint DOG tokens to test addresses for minting
        uint256 dogAmount = DOG_TO_PIXEL_SATOSHIS * 10; // Enough for 10 mints each
        dogToken.mint(minter1, dogAmount);
        dogToken.mint(minter2, dogAmount);
        dogToken.mint(minter3, dogAmount);
        dogToken.mint(minter4, dogAmount);

        // Approve PX contract to spend DOG tokens
        vm.prank(minter1);
        dogToken.approve(address(pxToken), type(uint256).max);
        vm.prank(minter2);
        dogToken.approve(address(pxToken), type(uint256).max);
        vm.prank(minter3);
        dogToken.approve(address(pxToken), type(uint256).max);
        vm.prank(minter4);
        dogToken.approve(address(pxToken), type(uint256).max);
    }

    function test_InitialState() public view {
        // Verify initial contract state
        assertEq(pxToken.name(), "Pixel Token");
        assertEq(pxToken.symbol(), "PX");
        assertEq(pxToken.totalSupply(), TOTAL_SUPPLY);
        assertEq(pxToken.puppersRemaining(), TOTAL_SUPPLY);
        assertEq(pxToken.SHIBA_WIDTH(), SHIBA_WIDTH);
        assertEq(pxToken.SHIBA_HEIGHT(), SHIBA_HEIGHT);
        assertEq(pxToken.INDEX_OFFSET(), INDEX_OFFSET);
        // Note: DOG_TO_PIXEL_SATOSHIS was removed as it was unused
        assertTrue(pxToken.paused()); // Contract starts paused
        assertTrue(pxToken.hasRole(pxToken.DEFAULT_ADMIN_ROLE(), owner));

        // Verify no tokens are minted initially
        assertEq(pxToken.balanceOf(owner), 0);

        console.log("Initial state verified:");
        console.log("  Total Supply:", pxToken.totalSupply());
        console.log("  Puppers Remaining:", pxToken.puppersRemaining());
        console.log("  Contract Paused:", pxToken.paused());
    }

    function test_PreAllocation() public {
        _moveToPreAllocationPhase();

        // Prepare pre-allocation data
        uint256[] memory tokenIds = new uint256[](PRE_ALLOCATED_COUNT);
        address[] memory recipients = new address[](PRE_ALLOCATED_COUNT);

        // Assign specific token IDs for pre-allocation (INDEX_OFFSET + 0 to INDEX_OFFSET + 9)
        for (uint256 i = 0; i < PRE_ALLOCATED_COUNT; i++) {
            tokenIds[i] = INDEX_OFFSET + i;
            recipients[i] = preAllocAddresses[i];
        }

        // Record initial state
        uint256 initialPuppersRemaining = pxToken.puppersRemaining();

        // Execute reservation (first step of new migration workflow)
        pxToken.reserveTokensForMigration(tokenIds, recipients);

        // Verify post-reservation state
        assertEq(pxToken.puppersRemaining(), initialPuppersRemaining - PRE_ALLOCATED_COUNT);
        assertEq(pxToken.puppersRemaining(), MINTABLE_COUNT);
        assertEq(pxToken.totalReserved(), PRE_ALLOCATED_COUNT);

        // Verify each token is reserved but not yet minted
        for (uint256 i = 0; i < PRE_ALLOCATED_COUNT; i++) {
            assertTrue(pxToken.isReserved(tokenIds[i]));
            (address reservedFor, bool burnConfirmed) = pxToken.getReservation(tokenIds[i]);
            assertEq(reservedFor, recipients[i]);
            assertFalse(burnConfirmed);
            assertEq(pxToken.balanceOf(recipients[i]), 0); // Not yet minted

            // Verify token doesn't exist yet (will revert on ownerOf and tokenURI)
            vm.expectRevert();
            pxToken.ownerOf(tokenIds[i]);

            vm.expectRevert();
            pxToken.tokenURI(tokenIds[i]);
        }

        console.log("Reservation completed:");
        console.log("  Reserved tokens:", PRE_ALLOCATED_COUNT);
        console.log("  Remaining for normal mint:", pxToken.puppersRemaining());

        _verifyInternalConsistency();
    }

    /**
     * @dev Complete the reservation workflow by setting burn flags and allowing claims
     * This simulates the full migration process
     */
    function _completeReservationWorkflow() internal {
        // Get reserved tokens from the preAllocation test
        uint256[] memory tokenIds = new uint256[](PRE_ALLOCATED_COUNT);
        for (uint256 i = 0; i < PRE_ALLOCATED_COUNT; i++) {
            tokenIds[i] = INDEX_OFFSET + i;
        }

        // Set burn flags for all reserved tokens (simulating burns on old contract)
        bool[] memory burnStatuses = new bool[](PRE_ALLOCATED_COUNT);
        for (uint256 i = 0; i < PRE_ALLOCATED_COUNT; i++) {
            burnStatuses[i] = true;
        }

        pxToken.setBurnFlags(tokenIds, burnStatuses);

        // Unpause temporarily for claims
        pxToken.unpause();

        // Give DOG tokens to pre-allocated addresses for claiming
        for (uint256 i = 0; i < PRE_ALLOCATED_COUNT; i++) {
            dogToken.mint(preAllocAddresses[i], DOG_TO_PIXEL_SATOSHIS * 2); // Extra for safety
            vm.prank(preAllocAddresses[i]);
            dogToken.approve(address(pxToken), type(uint256).max);
        }

        // Users claim their reserved tokens
        for (uint256 i = 0; i < PRE_ALLOCATED_COUNT; i++) {
            vm.prank(preAllocAddresses[i]);
            pxToken.claimReservedToken(tokenIds[i], address(dogToken));
        }

        // Verify all tokens were claimed
        assertEq(pxToken.totalReserved(), 0);
        for (uint256 i = 0; i < PRE_ALLOCATED_COUNT; i++) {
            assertEq(pxToken.ownerOf(tokenIds[i]), preAllocAddresses[i]);
            assertEq(pxToken.balanceOf(preAllocAddresses[i]), 1);
        }

        // Pause again for the test flow
        pxToken.pause();

        console.log("Reservation workflow completed:");
        console.log("  All", PRE_ALLOCATED_COUNT, "reserved tokens claimed");
    }

    function test_NormalMinting() public {
        _moveToMintingPhase();

        // Test single mints from different addresses
        _testSingleMints();

        // Test multiple mints in single transaction
        _testMultipleMints();

        // Test remaining capacity and exhaustion
        _testMintExhaustion();

        _verifyFinalState();
    }

    function _moveToPreAllocationPhase() internal view {
        // Contract starts paused, which is perfect for pre-allocation
        assertTrue(pxToken.paused());
    }

    function _moveToMintingPhase() internal {
        // First do pre-allocation (reserve tokens)
        test_PreAllocation();

        // Complete the reservation workflow (burn flags + claims)
        _completeReservationWorkflow();

        // Unpause contract for normal minting
        pxToken.unpause();
        assertFalse(pxToken.paused());

        console.log("Moved to minting phase - contract unpaused");
        console.log("Available for normal minting:", pxToken.getAvailableSupply());
    }

    function _testSingleMints() internal {
        console.log("Testing single mints...");

        uint256 initialPuppersRemaining = pxToken.puppersRemaining();
        uint256 mintCount = 0;

        // Minter1: Single mint
        uint256 minter1BalanceBefore = pxToken.balanceOf(minter1);
        uint256 dogBalanceBefore = dogToken.balanceOf(minter1);

        vm.prank(minter1);
        pxToken.mintPuppers(1, address(dogToken));

        assertEq(pxToken.balanceOf(minter1), minter1BalanceBefore + 1);
        assertEq(pxToken.puppersRemaining(), initialPuppersRemaining - 1);
        assertEq(dogToken.balanceOf(minter1), dogBalanceBefore - DOG_TO_PIXEL_SATOSHIS);
        mintCount++;

        // Minter2: Single mint
        uint256 minter2BalanceBefore = pxToken.balanceOf(minter2);

        vm.prank(minter2);
        pxToken.mintPuppers(1, address(dogToken));

        assertEq(pxToken.balanceOf(minter2), minter2BalanceBefore + 1);
        assertEq(pxToken.puppersRemaining(), initialPuppersRemaining - 2);
        mintCount++;

        // Minter3: Single mint
        vm.prank(minter3);
        pxToken.mintPuppers(1, address(dogToken));

        assertEq(pxToken.puppersRemaining(), initialPuppersRemaining - 3);
        mintCount++;

        console.log("  Single mints completed:", mintCount);
        console.log("  Puppers remaining:", pxToken.puppersRemaining());

        _verifyInternalConsistency();
    }

    function _testMultipleMints() internal {
        console.log("Testing multiple mints...");

        uint256 puppersRemaining = pxToken.puppersRemaining();

        // Minter1: Mint 2 more
        uint256 minter1BalanceBefore = pxToken.balanceOf(minter1);

        vm.prank(minter1);
        pxToken.mintPuppers(2, address(dogToken));

        assertEq(pxToken.balanceOf(minter1), minter1BalanceBefore + 2);
        assertEq(pxToken.puppersRemaining(), puppersRemaining - 2);
        puppersRemaining -= 2;

        // Minter2: Mint 3 more
        uint256 minter2BalanceBefore = pxToken.balanceOf(minter2);

        vm.prank(minter2);
        pxToken.mintPuppers(3, address(dogToken));

        assertEq(pxToken.balanceOf(minter2), minter2BalanceBefore + 3);
        assertEq(pxToken.puppersRemaining(), puppersRemaining - 3);
        puppersRemaining -= 3;

        console.log("  Multiple mints completed");
        console.log("  Puppers remaining:", pxToken.puppersRemaining());

        _verifyInternalConsistency();
    }

    function _testMintExhaustion() internal {
        console.log("Testing mint exhaustion...");

        uint256 puppersRemaining = pxToken.puppersRemaining();
        console.log("  Puppers remaining before exhaustion:", puppersRemaining);

        // Should have 2 puppers left (10 total - 3 single - 2 - 3 multiple = 2)
        assertEq(puppersRemaining, 2);

        // Minter4: Mint the last 2
        vm.prank(minter4);
        pxToken.mintPuppers(2, address(dogToken));

        assertEq(pxToken.puppersRemaining(), 0);
        assertEq(pxToken.balanceOf(minter4), 2);

        // Try to mint when exhausted - should fail
        vm.prank(minter1);
        vm.expectRevert(abi.encodeWithSelector(NoPuppersRemaining.selector));
        pxToken.mintPuppers(1, address(dogToken));

        // Try to mint 0 - should fail
        vm.prank(minter1);
        vm.expectRevert(abi.encodeWithSelector(NonPositiveQuantity.selector));
        pxToken.mintPuppers(0, address(dogToken));

        console.log("  All tokens minted successfully");
        console.log("  Final puppers remaining:", pxToken.puppersRemaining());

        _verifyInternalConsistency();
    }

    function _verifyFinalState() internal view {
        console.log("Verifying final state...");

        // Verify total supply and distribution
        assertEq(pxToken.puppersRemaining(), 0);

        // Count total tokens across all holders
        uint256 totalMinted = 0;

        // Pre-allocated tokens
        for (uint256 i = 0; i < PRE_ALLOCATED_COUNT; i++) {
            totalMinted += pxToken.balanceOf(preAllocAddresses[i]);
        }

        // Normal minted tokens
        totalMinted += pxToken.balanceOf(minter1); // 1 + 2 = 3
        totalMinted += pxToken.balanceOf(minter2); // 1 + 3 = 4
        totalMinted += pxToken.balanceOf(minter3); // 1
        totalMinted += pxToken.balanceOf(minter4); // 2

        assertEq(totalMinted, TOTAL_SUPPLY);

        // Verify specific balances
        assertEq(pxToken.balanceOf(minter1), 3);
        assertEq(pxToken.balanceOf(minter2), 4);
        assertEq(pxToken.balanceOf(minter3), 1);
        assertEq(pxToken.balanceOf(minter4), 2);

        // Verify all token IDs are owned correctly
        _verifyAllTokenOwnership();

        console.log("Final state verification complete:");
        console.log("  Total tokens minted:", totalMinted);
        console.log("  Minter1 balance:", pxToken.balanceOf(minter1));
        console.log("  Minter2 balance:", pxToken.balanceOf(minter2));
        console.log("  Minter3 balance:", pxToken.balanceOf(minter3));
        console.log("  Minter4 balance:", pxToken.balanceOf(minter4));
    }

    function _verifyAllTokenOwnership() internal view {
        console.log("Verifying all token ownership...");

        uint256 ownedTokens = 0;

        // Check all possible token IDs
        for (uint256 i = 0; i < TOTAL_SUPPLY; i++) {
            uint256 tokenId = INDEX_OFFSET + i;

            try pxToken.ownerOf(tokenId) returns (address tokenOwner) {
                if (tokenOwner != address(0)) {
                    // Verify token owner is either pre-allocated or a minter
                    bool isValidOwner = false;

                    // Check pre-allocated addresses
                    for (uint256 j = 0; j < PRE_ALLOCATED_COUNT; j++) {
                        if (tokenOwner == preAllocAddresses[j]) {
                            isValidOwner = true;
                            break;
                        }
                    }

                    // Check minter addresses
                    if (!isValidOwner) {
                        isValidOwner =
                        (tokenOwner == minter1 || tokenOwner == minter2 || tokenOwner == minter3
                                || tokenOwner == minter4);
                    }

                    assertTrue(isValidOwner, "Token owned by unexpected address");
                    ownedTokens++;

                    // Verify token URI
                    string memory tokenURI = pxToken.tokenURI(tokenId);
                    assertTrue(bytes(tokenURI).length > 0, "Token URI should not be empty");

                    // Verify pixel coordinates
                    uint256[2] memory coords = pxToken.pupperToPixelCoords(tokenId);
                    assertTrue(coords[0] < SHIBA_WIDTH, "X coordinate out of bounds");
                    assertTrue(coords[1] < SHIBA_HEIGHT, "Y coordinate out of bounds");
                }
            } catch {
                // Token doesn't exist, continue
            }
        }

        assertEq(ownedTokens, TOTAL_SUPPLY);
        console.log("  All token ownership verified, total owned:", ownedTokens);
    }

    function _verifyInternalConsistency() internal view {
        // Verify that puppersRemaining + minted tokens = totalSupply
        uint256 totalMinted = 0;

        // Count minted tokens
        for (uint256 i = 0; i < TOTAL_SUPPLY; i++) {
            uint256 tokenId = INDEX_OFFSET + i;
            try pxToken.ownerOf(tokenId) returns (address tokenOwner) {
                if (tokenOwner != address(0)) {
                    totalMinted++;
                }
            } catch {
                // Token doesn't exist, continue
            }
        }

        // With reservation system: puppersRemaining + minted + reserved = totalSupply
        uint256 totalReserved = pxToken.totalReserved();
        assertEq(totalMinted + pxToken.puppersRemaining() + totalReserved, TOTAL_SUPPLY);

        console.log("Internal consistency check:");
        console.log("  Minted:", totalMinted);
        console.log("  Available:", pxToken.puppersRemaining());
        console.log("  Reserved:", totalReserved);
        console.log("  Total:", totalMinted + pxToken.puppersRemaining() + totalReserved);
    }

    // Test burning functionality
    function test_BurnFunctionality() public {
        _moveToMintingPhase();

        console.log("Testing burn functionality...");

        // Mint some tokens first
        vm.prank(minter1);
        pxToken.mintPuppers(2, address(dogToken));

        uint256 minter1Balance = pxToken.balanceOf(minter1);
        uint256 puppersRemaining = pxToken.puppersRemaining();

        // Get one of minter1's tokens
        uint256 tokenToBurn = 0;
        for (uint256 i = 0; i < TOTAL_SUPPLY; i++) {
            uint256 tokenId = INDEX_OFFSET + i;
            try pxToken.ownerOf(tokenId) returns (address tokenOwner) {
                if (tokenOwner == minter1) {
                    tokenToBurn = tokenId;
                    break;
                }
            } catch {
                // Token doesn't exist, continue
            }
        }

        assertTrue(tokenToBurn != 0, "Should find a token to burn");

        // Burn the token
        uint256[] memory tokensToBurn = new uint256[](1);
        tokensToBurn[0] = tokenToBurn;

        uint256 dogBalanceBefore = dogToken.balanceOf(minter1);

        vm.prank(minter1);
        pxToken.burnPuppers(tokensToBurn);

        // Verify burn effects
        assertEq(pxToken.balanceOf(minter1), minter1Balance - 1);
        assertEq(pxToken.puppersRemaining(), puppersRemaining + 1);

        // Verify token no longer exists
        vm.expectRevert(abi.encodeWithSelector(ERC721OwnerQueryForNonexistentToken.selector));
        pxToken.ownerOf(tokenToBurn);

        // Verify DOG refund (minus fees)
        uint256 dogBalanceAfter = dogToken.balanceOf(minter1);
        uint256 expectedRefund = DOG_TO_PIXEL_SATOSHIS - (DOG_TO_PIXEL_SATOSHIS / 100); // 1% dev fee
        assertEq(dogBalanceAfter, dogBalanceBefore + expectedRefund);

        console.log("  Burn functionality verified");
        console.log("  Token burned:", tokenToBurn);
        console.log("  Puppers remaining after burn:", pxToken.puppersRemaining());
    }

    // Test edge case: mint and burn cycles
    function test_MintBurnCycles() public {
        _moveToMintingPhase();

        console.log("Testing mint-burn cycles...");

        uint256 initialPuppersRemaining = pxToken.puppersRemaining();

        // Mint some tokens
        vm.prank(minter1);
        pxToken.mintPuppers(3, address(dogToken));

        assertEq(pxToken.puppersRemaining(), initialPuppersRemaining - 3);

        // Get all minter1's tokens
        uint256[] memory ownedTokens = new uint256[](3);
        uint256 tokenCount = 0;

        for (uint256 i = 0; i < TOTAL_SUPPLY && tokenCount < 3; i++) {
            uint256 tokenId = INDEX_OFFSET + i;
            try pxToken.ownerOf(tokenId) returns (address tokenOwner) {
                if (tokenOwner == minter1) {
                    ownedTokens[tokenCount] = tokenId;
                    tokenCount++;
                }
            } catch {
                // Token doesn't exist, continue
            }
        }

        assertEq(tokenCount, 3);

        // Burn 2 tokens
        uint256[] memory tokensToBurn = new uint256[](2);
        tokensToBurn[0] = ownedTokens[0];
        tokensToBurn[1] = ownedTokens[1];

        vm.prank(minter1);
        pxToken.burnPuppers(tokensToBurn);

        assertEq(pxToken.puppersRemaining(), initialPuppersRemaining - 1);
        assertEq(pxToken.balanceOf(minter1), 1);

        // Mint again
        vm.prank(minter2);
        pxToken.mintPuppers(2, address(dogToken));

        assertEq(pxToken.puppersRemaining(), initialPuppersRemaining - 3);
        assertEq(pxToken.balanceOf(minter2), 2);

        console.log("  Mint-burn cycles completed successfully");

        _verifyInternalConsistency();
    }

    // Helper function to get random seed for testing randomness
    function test_RandomnessDistribution() public {
        _moveToMintingPhase();

        console.log("Testing randomness distribution...");

        // Mint several tokens and verify they're distributed
        uint256[] memory mintedTokens = new uint256[](5);

        vm.prank(minter1);
        pxToken.mintPuppers(1, address(dogToken));
        mintedTokens[0] = _getLastMintedToken(minter1);

        vm.prank(minter2);
        pxToken.mintPuppers(1, address(dogToken));
        mintedTokens[1] = _getLastMintedToken(minter2);

        vm.prank(minter3);
        pxToken.mintPuppers(1, address(dogToken));
        mintedTokens[2] = _getLastMintedToken(minter3);

        vm.prank(minter4);
        pxToken.mintPuppers(1, address(dogToken));
        mintedTokens[3] = _getLastMintedToken(minter4);

        vm.prank(minter1);
        pxToken.mintPuppers(1, address(dogToken));
        mintedTokens[4] = _getLastMintedToken(minter1);

        // Verify all tokens are different (randomness working)
        for (uint256 i = 0; i < 5; i++) {
            for (uint256 j = i + 1; j < 5; j++) {
                assertTrue(mintedTokens[i] != mintedTokens[j], "Tokens should be different");
            }
            console.log("  Minted token:", mintedTokens[i]);
        }

        console.log("  Randomness distribution verified");
    }

    function _getLastMintedToken(address minter) internal view returns (uint256) {
        // Find the most recently minted token for a given minter
        for (uint256 i = TOTAL_SUPPLY; i > 0; i--) {
            uint256 tokenId = INDEX_OFFSET + i - 1;
            try pxToken.ownerOf(tokenId) returns (address tokenOwner) {
                if (tokenOwner == minter) {
                    return tokenId;
                }
            } catch {
                // Token doesn't exist, continue
            }
        }
        revert("No token found for minter");
    }

    // Test contract upgrade scenario
    function test_UpgradePreparation() public {
        _moveToMintingPhase();

        console.log("Testing upgrade preparation...");

        // Mint some tokens to create state
        vm.prank(minter1);
        pxToken.mintPuppers(2, address(dogToken));

        // Pause contract (simulating upgrade preparation)
        pxToken.pause();
        assertTrue(pxToken.paused());

        // Verify minting is disabled when paused
        vm.prank(minter2);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        pxToken.mintPuppers(1, address(dogToken));

        // Verify burning is disabled when paused
        uint256[] memory tokensToBurn = new uint256[](1);
        for (uint256 i = 0; i < TOTAL_SUPPLY; i++) {
            uint256 tokenId = INDEX_OFFSET + i;
            try pxToken.ownerOf(tokenId) returns (address tokenOwner) {
                if (tokenOwner == minter1) {
                    tokensToBurn[0] = tokenId;
                    break;
                }
            } catch {
                // Token doesn't exist, continue
            }
        }

        vm.prank(minter1);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        pxToken.burnPuppers(tokensToBurn);

        // Verify view functions still work
        assertTrue(pxToken.puppersRemaining() > 0);
        assertTrue(pxToken.totalSupply() == TOTAL_SUPPLY);

        console.log("  Contract properly pausable for upgrades");
    }
}
