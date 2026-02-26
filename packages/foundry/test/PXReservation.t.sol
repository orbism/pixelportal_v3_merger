// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {PX} from "../src/PX.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// Import custom errors
import {BurnNotConfirmed, NotReservedForYou, TokenAlreadyReserved, TokenNotReserved} from "../src/PX.sol";

contract PXReservationTest is Test {
    PX public px;
    ERC20Mock public dog20;

    address public owner = address(0x1);
    address public user1 = address(0x2);
    address public user2 = address(0x3);

    uint256 public constant INDEX_OFFSET = 1000000;
    uint256 public constant DOG_TO_PIXEL_SATOSHIS = 5523989899 * 10 ** 13;

    event TokenReserved(uint256 indexed tokenId, address indexed reservedFor);
    event BurnFlagSet(uint256 indexed tokenId, bool burnConfirmed);
    event ReservedTokenClaimed(uint256 indexed tokenId, address indexed claimer);

    function setUp() public {
        // Deploy mock DOG token
        dog20 = new ERC20Mock();

        // Deploy PX implementation
        PX implementation = new PX();

        // Deploy proxy
        bytes memory initData = abi.encodeWithSelector(
            PX.__PX_init.selector, "Pixel", "PX", address(dog20), "ipfs://", 1000, 1000, owner, owner
        );

        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), initData);
        px = PX(address(proxy));

        // Contract starts paused, configure DOG20 token while paused
        vm.startPrank(owner);
        // Configure DOG20 token for locking (required for new token lock system)
        px.setTokenLockAmount(address(dog20), DOG_TO_PIXEL_SATOSHIS);
        vm.stopPrank();

        // Note: Keeping contract paused as reserveTokensForMigration requires whenPaused
        // Individual tests will unpause when needed for claiming

        // Setup DOG tokens for users (need more than DOG_TO_PIXEL_SATOSHIS for multiple claims)
        dog20.mint(user1, 1000000e18);
        dog20.mint(user2, 1000000e18);

        vm.prank(user1);
        dog20.approve(address(px), type(uint256).max);

        vm.prank(user2);
        dog20.approve(address(px), type(uint256).max);
    }

    function test_ReserveTokens() public {
        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = INDEX_OFFSET + 1;
        tokenIds[1] = INDEX_OFFSET + 2;

        address[] memory recipients = new address[](2);
        recipients[0] = user1;
        recipients[1] = user2;

        // Reserve tokens
        vm.expectEmit(true, true, false, false);
        emit TokenReserved(tokenIds[0], user1);
        vm.expectEmit(true, true, false, false);
        emit TokenReserved(tokenIds[1], user2);

        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients);

        // Verify reservations
        assertTrue(px.isReserved(tokenIds[0]));
        assertTrue(px.isReserved(tokenIds[1]));
        assertEq(px.totalReserved(), 2);

        (address reservedFor0, bool burnConfirmed0) = px.getReservation(tokenIds[0]);
        assertEq(reservedFor0, user1);
        assertFalse(burnConfirmed0);

        (address reservedFor1, bool burnConfirmed1) = px.getReservation(tokenIds[1]);
        assertEq(reservedFor1, user2);
        assertFalse(burnConfirmed1);
    }

    function test_TotalSupplyWithAndWithoutReservations() public {
        uint256 expectedTotalSupply = 1000 * 1000;
        assertEq(px.totalSupply(), expectedTotalSupply);

        uint256[] memory tokenIds = new uint256[](3);
        address[] memory recipients = new address[](3);

        for (uint256 i = 0; i < 3; i++) {
            tokenIds[i] = INDEX_OFFSET + i + 1;
            recipients[i] = user1;
        }

        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients);

        assertEq(px.totalSupply(), expectedTotalSupply);
        assertEq(px.totalReserved(), 3);
        assertEq(px.puppersRemaining(), expectedTotalSupply - 3);
    }

    function test_SetBurnFlags() public {
        // First reserve tokens
        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = INDEX_OFFSET + 1;
        tokenIds[1] = INDEX_OFFSET + 2;

        address[] memory recipients = new address[](2);
        recipients[0] = user1;
        recipients[1] = user2;

        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients);

        // Set burn flags
        bool[] memory burnStatuses = new bool[](2);
        burnStatuses[0] = true;
        burnStatuses[1] = false;

        vm.expectEmit(true, false, false, false);
        emit BurnFlagSet(tokenIds[0], true);
        vm.expectEmit(true, false, false, false);
        emit BurnFlagSet(tokenIds[1], false);

        vm.prank(owner);
        px.setBurnFlags(tokenIds, burnStatuses);

        // Verify burn flags
        (, bool burnConfirmed0) = px.getReservation(tokenIds[0]);
        assertTrue(burnConfirmed0);

        (, bool burnConfirmed1) = px.getReservation(tokenIds[1]);
        assertFalse(burnConfirmed1);
    }

    function test_ClaimReservedToken() public {
        uint256 tokenId = INDEX_OFFSET + 1;
        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = tokenId;

        address[] memory recipients = new address[](1);
        recipients[0] = user1;

        // Reserve and set burn flag
        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients);

        bool[] memory burnStatuses = new bool[](1);
        burnStatuses[0] = true;

        vm.prank(owner);
        px.setBurnFlags(tokenIds, burnStatuses);

        // Unpause to allow claiming
        vm.prank(owner);
        px.unpause();

        // Claim token
        vm.expectEmit(true, true, true, true);
        emit ReservedTokenClaimed(tokenId, user1);

        vm.prank(user1);
        px.claimReservedToken(tokenId, address(dog20));

        // Verify claim
        assertEq(px.ownerOf(tokenId), user1);
        assertFalse(px.isReserved(tokenId));
        assertEq(px.totalReserved(), 0);
        assertEq(px.balanceOf(user1), 1);
    }

    function test_CannotClaimWithoutBurnFlag() public {
        uint256 tokenId = INDEX_OFFSET + 1;
        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = tokenId;

        address[] memory recipients = new address[](1);
        recipients[0] = user1;

        // Reserve but don't set burn flag
        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients);

        vm.prank(owner);
        px.unpause();

        // Should fail to claim
        vm.expectRevert(abi.encodeWithSelector(BurnNotConfirmed.selector));
        vm.prank(user1);
        px.claimReservedToken(tokenId, address(dog20));
    }

    function test_CannotClaimWrongUser() public {
        uint256 tokenId = INDEX_OFFSET + 1;
        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = tokenId;

        address[] memory recipients = new address[](1);
        recipients[0] = user1;

        // Reserve and set burn flag
        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients);

        bool[] memory burnStatuses = new bool[](1);
        burnStatuses[0] = true;

        vm.prank(owner);
        px.setBurnFlags(tokenIds, burnStatuses);

        vm.prank(owner);
        px.unpause();

        // Wrong user tries to claim
        vm.expectRevert(abi.encodeWithSelector(NotReservedForYou.selector));
        vm.prank(user2);
        px.claimReservedToken(tokenId, address(dog20));
    }

    function test_ReservationWorkflow() public {
        // Complete workflow: reserve -> set burn flags -> claim
        uint256[] memory tokenIds = new uint256[](3);
        tokenIds[0] = INDEX_OFFSET + 1;
        tokenIds[1] = INDEX_OFFSET + 2;
        tokenIds[2] = INDEX_OFFSET + 3;

        address[] memory recipients = new address[](3);
        recipients[0] = user1;
        recipients[1] = user2;
        recipients[2] = user1;

        // Step 1: Reserve tokens
        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients);

        assertEq(px.totalReserved(), 3);
        assertEq(px.getAvailableSupply(), px.puppersRemaining() - 3);

        // Step 2: Set burn flags (only for some tokens)
        uint256[] memory burnTokenIds = new uint256[](2);
        burnTokenIds[0] = tokenIds[0];
        burnTokenIds[1] = tokenIds[2];

        bool[] memory burnStatuses = new bool[](2);
        burnStatuses[0] = true;
        burnStatuses[1] = true;

        vm.prank(owner);
        px.setBurnFlags(burnTokenIds, burnStatuses);

        // Step 3: Check claim eligibility
        assertTrue(px.canClaimReservedToken(tokenIds[0], user1));
        assertFalse(px.canClaimReservedToken(tokenIds[1], user2)); // burn not confirmed
        assertTrue(px.canClaimReservedToken(tokenIds[2], user1));

        // Step 4: Unpause and claim
        vm.prank(owner);
        px.unpause();

        vm.prank(user1);
        px.claimReservedToken(tokenIds[0], address(dog20));

        vm.prank(user1);
        px.claimReservedToken(tokenIds[2], address(dog20));

        // Verify final state
        assertEq(px.ownerOf(tokenIds[0]), user1);
        assertEq(px.ownerOf(tokenIds[2]), user1);
        assertEq(px.balanceOf(user1), 2);
        assertEq(px.totalReserved(), 1); // Only tokenIds[1] still reserved

        // Token 1 should still be reserved
        assertTrue(px.isReserved(tokenIds[1]));
        (address reservedFor, bool burnConfirmed) = px.getReservation(tokenIds[1]);
        assertEq(reservedFor, user2);
        assertFalse(burnConfirmed);
    }

    function test_ReservationsExcludedFromRegularMinting() public {
        // Reserve some tokens
        uint256[] memory tokenIds = new uint256[](10);
        address[] memory recipients = new address[](10);

        for (uint256 i = 0; i < 10; i++) {
            tokenIds[i] = INDEX_OFFSET + i + 1;
            recipients[i] = user1;
        }

        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients);

        // Unpause to allow regular minting
        vm.prank(owner);
        px.unpause();

        // Try to mint tokens - should not get any reserved ones
        vm.prank(user2);
        px.mintPuppers(5, address(dog20));

        // Check that user2 didn't get any of the reserved tokens
        for (uint256 i = 0; i < 10; i++) {
            assertTrue(px.isReserved(tokenIds[i]));
            // Token should still be reserved and not owned by user2
        }

        assertEq(px.balanceOf(user2), 5);
    }

    function test_GetReservedTokensForUser() public {
        // Test individual reservation queries instead of the gas-intensive search function
        uint256[] memory tokenIds = new uint256[](3);
        address[] memory recipients = new address[](3);

        tokenIds[0] = INDEX_OFFSET + 1;
        tokenIds[1] = INDEX_OFFSET + 2;
        tokenIds[2] = INDEX_OFFSET + 3;

        recipients[0] = user1;
        recipients[1] = user2;
        recipients[2] = user1;

        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients);

        // Set burn flag for one token
        uint256[] memory burnTokenIds = new uint256[](1);
        burnTokenIds[0] = tokenIds[0];
        bool[] memory burnStatuses = new bool[](1);
        burnStatuses[0] = true;

        vm.prank(owner);
        px.setBurnFlags(burnTokenIds, burnStatuses);

        // Test individual reservation queries
        (address reservedFor0, bool burnConfirmed0) = px.getReservation(tokenIds[0]);
        assertEq(reservedFor0, user1);
        assertTrue(burnConfirmed0);

        (address reservedFor1, bool burnConfirmed1) = px.getReservation(tokenIds[1]);
        assertEq(reservedFor1, user2);
        assertFalse(burnConfirmed1);

        (address reservedFor2, bool burnConfirmed2) = px.getReservation(tokenIds[2]);
        assertEq(reservedFor2, user1);
        assertFalse(burnConfirmed2);

        // Test claim eligibility
        assertTrue(px.canClaimReservedToken(tokenIds[0], user1));
        assertFalse(px.canClaimReservedToken(tokenIds[1], user2));
        assertFalse(px.canClaimReservedToken(tokenIds[2], user1));
    }

    function test_ErrorCases() public {
        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = INDEX_OFFSET + 1;
        address[] memory recipients = new address[](1);
        recipients[0] = user1;

        // Test: Cannot reserve same token twice
        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients);

        vm.expectRevert(abi.encodeWithSelector(TokenAlreadyReserved.selector));
        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients);

        // Test: Cannot set burn flag for non-reserved token
        uint256[] memory nonReservedTokens = new uint256[](1);
        nonReservedTokens[0] = INDEX_OFFSET + 100;
        bool[] memory burnStatuses = new bool[](1);
        burnStatuses[0] = true;

        vm.expectRevert(abi.encodeWithSelector(TokenNotReserved.selector));
        vm.prank(owner);
        px.setBurnFlags(nonReservedTokens, burnStatuses);

        // Test: Cannot get reservation for non-reserved token
        vm.expectRevert(abi.encodeWithSelector(TokenNotReserved.selector));
        px.getReservation(INDEX_OFFSET + 100);

        // Test: Cannot claim token twice
        bool[] memory burnTrue = new bool[](1);
        burnTrue[0] = true;

        vm.prank(owner);
        px.setBurnFlags(tokenIds, burnTrue);

        vm.prank(owner);
        px.unpause();

        vm.prank(user1);
        px.claimReservedToken(tokenIds[0], address(dog20));

        vm.expectRevert(abi.encodeWithSelector(TokenNotReserved.selector));
        vm.prank(user1);
        px.claimReservedToken(tokenIds[0], address(dog20));
    }

    function test_PauseRequirements() public {
        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = INDEX_OFFSET + 1;
        address[] memory recipients = new address[](1);
        recipients[0] = user1;

        // Test: Reservations can only be made while paused (contract starts paused)
        assertTrue(px.paused());

        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients); // Should work

        // Test: Cannot reserve while unpaused
        vm.prank(owner);
        px.unpause();
        assertFalse(px.paused());

        uint256[] memory tokenIds2 = new uint256[](1);
        tokenIds2[0] = INDEX_OFFSET + 2;
        address[] memory recipients2 = new address[](1);
        recipients2[0] = user2;

        vm.expectRevert(abi.encodeWithSignature("ExpectedPause()"));
        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds2, recipients2);

        // Test: Burn flags can be set while unpaused
        bool[] memory burnStatuses = new bool[](1);
        burnStatuses[0] = true;

        vm.prank(owner);
        px.setBurnFlags(tokenIds, burnStatuses); // Should work while unpaused

        // Test: Claims can only be made while unpaused
        vm.prank(user1);
        px.claimReservedToken(tokenIds[0], address(dog20)); // Should work while unpaused

        // Test: Cannot claim while paused
        vm.prank(owner);
        px.pause();
        assertTrue(px.paused());

        // Reserve another token while paused
        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds2, recipients2);

        vm.prank(owner);
        px.setBurnFlags(tokenIds2, burnStatuses);

        // Try to claim while paused - should fail
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        vm.prank(user2);
        px.claimReservedToken(tokenIds2[0], address(dog20));

        // Unpause and claim should work
        vm.prank(owner);
        px.unpause();

        vm.prank(user2);
        px.claimReservedToken(tokenIds2[0], address(dog20)); // Should work
    }

    function test_ClaimPaymentAndClearing() public {
        uint256 tokenId = INDEX_OFFSET + 1;
        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = tokenId;
        address[] memory recipients = new address[](1);
        recipients[0] = user1;

        // Reserve token
        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients);

        // Set burn flag
        bool[] memory burnStatuses = new bool[](1);
        burnStatuses[0] = true;
        vm.prank(owner);
        px.setBurnFlags(tokenIds, burnStatuses);

        // Unpause for claiming
        vm.prank(owner);
        px.unpause();

        // Check initial state
        uint256 initialDogBalance = dog20.balanceOf(user1);
        uint256 initialContractBalance = dog20.balanceOf(address(px));
        uint256 initialTotalReserved = px.totalReserved();

        assertTrue(px.isReserved(tokenId));
        (address reservedFor, bool burnConfirmed) = px.getReservation(tokenId);
        assertEq(reservedFor, user1);
        assertTrue(burnConfirmed);

        // Get the DOG_TO_PIXEL_SATOSHIS value for verification
        // Regular mint costs this amount per token
        uint256 expectedPayment = DOG_TO_PIXEL_SATOSHIS;

        // Claim the token
        vm.prank(user1);
        px.claimReservedToken(tokenId, address(dog20));

        // Verify payment - should match regular mint cost
        assertEq(dog20.balanceOf(user1), initialDogBalance - expectedPayment);
        assertEq(dog20.balanceOf(address(px)), initialContractBalance + expectedPayment);

        // Verify reservation is completely cleared
        assertFalse(px.isReserved(tokenId));
        assertEq(px.totalReserved(), initialTotalReserved - 1);

        // Should revert when trying to get reservation (token no longer reserved)
        vm.expectRevert(abi.encodeWithSelector(TokenNotReserved.selector));
        px.getReservation(tokenId);

        // Verify token is now owned
        assertEq(px.ownerOf(tokenId), user1);
        assertEq(px.balanceOf(user1), 1);
    }

    function test_ClaimPaymentComparison() public {
        // Compare claim payment with regular mint payment
        uint256 claimTokenId = INDEX_OFFSET + 1;
        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = claimTokenId;
        address[] memory recipients = new address[](1);
        recipients[0] = user1;

        // Reserve and prepare for claim
        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients);

        bool[] memory burnStatuses = new bool[](1);
        burnStatuses[0] = true;
        vm.prank(owner);
        px.setBurnFlags(tokenIds, burnStatuses);

        vm.prank(owner);
        px.unpause();

        // Record balances before claim
        uint256 user1BalanceBefore = dog20.balanceOf(user1);

        // User1 claims reserved token
        vm.prank(user1);
        px.claimReservedToken(claimTokenId, address(dog20));

        uint256 claimCost = user1BalanceBefore - dog20.balanceOf(user1);

        // Record balances before regular mint
        uint256 user2BalanceBefore = dog20.balanceOf(user2);

        // User2 does regular mint
        vm.prank(user2);
        px.mintPuppers(1, address(dog20));

        uint256 mintCost = user2BalanceBefore - dog20.balanceOf(user2);

        // Verify costs are identical
        assertEq(claimCost, mintCost);

        console.log("Claim cost:", claimCost);
        console.log("Mint cost:", mintCost);
        console.log("Both costs are equal:", claimCost == mintCost);
    }

    function test_CannotClaimTwice() public {
        uint256 tokenId = INDEX_OFFSET + 1;
        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = tokenId;
        address[] memory recipients = new address[](1);
        recipients[0] = user1;

        // Setup reservation and claim
        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients);

        bool[] memory burnStatuses = new bool[](1);
        burnStatuses[0] = true;
        vm.prank(owner);
        px.setBurnFlags(tokenIds, burnStatuses);

        vm.prank(owner);
        px.unpause();

        // First claim should work
        vm.prank(user1);
        px.claimReservedToken(tokenId, address(dog20));

        // Second claim should fail - reservation cleared
        vm.expectRevert(abi.encodeWithSelector(TokenNotReserved.selector));
        vm.prank(user1);
        px.claimReservedToken(tokenId, address(dog20));
    }

    function test_ClaimInsufficientFunds() public {
        uint256 tokenId = INDEX_OFFSET + 1;
        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = tokenId;
        address[] memory recipients = new address[](1);
        recipients[0] = user1;

        // Setup reservation
        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients);

        bool[] memory burnStatuses = new bool[](1);
        burnStatuses[0] = true;
        vm.prank(owner);
        px.setBurnFlags(tokenIds, burnStatuses);

        vm.prank(owner);
        px.unpause();

        // Remove most of user1's DOG tokens to cause insufficient funds
        uint256 currentBalance = dog20.balanceOf(user1);
        uint256 smallBalance = 1000; // Much less than DOG_TO_PIXEL_SATOSHIS

        vm.prank(user1);
        require(dog20.transfer(address(0xdead), currentBalance - smallBalance), "Transfer failed");

        assertLt(dog20.balanceOf(user1), DOG_TO_PIXEL_SATOSHIS);

        // Claim should fail due to insufficient funds
        vm.expectRevert(); // Will revert with ERC20InsufficientBalance or similar
        vm.prank(user1);
        px.claimReservedToken(tokenId, address(dog20));

        // Verify reservation still exists (not cleared due to failed claim)
        assertTrue(px.isReserved(tokenId));
    }
}
