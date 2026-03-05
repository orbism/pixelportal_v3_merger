// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {PXV3} from "../src/PXV3.sol";
import {MockDOG20} from "./mocks/MockDOG20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title PXUpgrade
 * @dev Comprehensive upgrade tests for PXV3 contract using UUPS pattern
 *
 * Test Coverage:
 * 1. UUPS upgrade access control (only owner can upgrade)
 * 2. Storage layout preservation during upgrades
 * 3. Functional verification after upgrade
 * 4. State preservation across upgrades
 */
contract PXUpgrade is Test {
    PXV3 public pxToken;
    MockDOG20 public dogToken;
    ERC1967Proxy public proxy;

    address public owner;
    address public attacker;
    address public devFeeAddress;
    address public minter1;
    address public minter2;

    // Constants
    uint256 public constant TOTAL_SUPPLY = 100; // 10x10 grid for testing
    uint256 public constant SHIBA_WIDTH = 10;
    uint256 public constant SHIBA_HEIGHT = 10;
    uint256 public constant INDEX_OFFSET = 1000000;
    uint256 public constant DOG_TO_PIXEL_SATOSHIS = 5523989899 * 10 ** 13;

    // Events to test
    event Upgraded(address indexed implementation);

    function setUp() public {
        // Set up test addresses
        owner = address(this);
        attacker = makeAddr("attacker");
        minter1 = makeAddr("minter1");
        minter2 = makeAddr("minter2");
        devFeeAddress = makeAddr("devFee");

        // Deploy DOG20 mock token
        dogToken = new MockDOG20();

        // Deploy PXV3 implementation
        PXV3 implementation = new PXV3();

        // Prepare initialization data
        bytes memory initData = abi.encodeWithSelector(
            PXV3.__PX_init.selector,
            "Pixel Token",
            "PX",
            address(dogToken),
            "ipfs://test-uri/",
            SHIBA_WIDTH,
            SHIBA_HEIGHT,
            devFeeAddress,
            owner // owner parameter for UUPS
        );

        // Deploy UUPS proxy with PXV3 implementation
        proxy = new ERC1967Proxy(address(implementation), initData);

        // Cast proxy to PXV3 interface
        pxToken = PXV3(address(proxy));

        // Set up DOG tokens for testing
        uint256 dogAmount = DOG_TO_PIXEL_SATOSHIS * 50;
        dogToken.mint(minter1, dogAmount);
        dogToken.mint(minter2, dogAmount);

        // Approve spending
        vm.prank(minter1);
        dogToken.approve(address(proxy), type(uint256).max);
        vm.prank(minter2);
        dogToken.approve(address(proxy), type(uint256).max);

        // Unpause for testing (startMinting is called per-test as needed)
        pxToken.unpause();

        // Configure DOG20 token for locking
        pxToken.setTokenLockAmount(address(dogToken), DOG_TO_PIXEL_SATOSHIS);
    }

    function test_UUPSAccessControl() public {
        console.log("Testing UUPS access control...");

        // Deploy new PXV3 implementation for upgrade
        PXV3 newImplementation = new PXV3();

        // Verify initial state
        assertTrue(pxToken.hasRole(pxToken.DEFAULT_ADMIN_ROLE(), owner));

        // Test: Non-admin cannot upgrade
        vm.startPrank(attacker);
        vm.expectRevert(
            abi.encodeWithSignature(
                "AccessControlUnauthorizedAccount(address,bytes32)", attacker, pxToken.DEFAULT_ADMIN_ROLE()
            )
        );
        UUPSUpgradeable(address(proxy)).upgradeToAndCall(address(newImplementation), "");
        vm.stopPrank();

        // Test: Owner can upgrade
        UUPSUpgradeable(address(proxy)).upgradeToAndCall(address(newImplementation), "");

        // Verify upgrade was successful
        _verifyImplementationAddress(address(newImplementation));

        console.log("  Access control tests passed");
        console.log("  Only contract owner can perform UUPS upgrades");
    }

    function test_StorageLayoutPreservation() public {
        console.log("Testing storage layout preservation...");

        // Create initial state
        _setupInitialState();

        // Record pre-upgrade state
        uint256 preUpgradePuppersRemaining = pxToken.puppersRemaining();
        uint256 preUpgradeTotalSupply = pxToken.totalSupply();
        bool preUpgradeHasAdminRole = pxToken.hasRole(pxToken.DEFAULT_ADMIN_ROLE(), owner);
        string memory preUpgradeName = pxToken.name();
        string memory preUpgradeSymbol = pxToken.symbol();
        uint256 preUpgradeBalance1 = pxToken.balanceOf(minter1);
        uint256 preUpgradeBalance2 = pxToken.balanceOf(minter2);

        console.log("  Pre-upgrade state recorded:");
        console.log("    Puppers remaining:", preUpgradePuppersRemaining);
        console.log("    Minter1 balance:", preUpgradeBalance1);
        console.log("    Minter2 balance:", preUpgradeBalance2);

        // Perform upgrade
        _upgrade();

        // Verify all storage is preserved
        assertEq(pxToken.puppersRemaining(), preUpgradePuppersRemaining);
        assertEq(pxToken.totalSupply(), preUpgradeTotalSupply);
        assertEq(pxToken.hasRole(pxToken.DEFAULT_ADMIN_ROLE(), owner), preUpgradeHasAdminRole);
        assertEq(pxToken.name(), preUpgradeName);
        assertEq(pxToken.symbol(), preUpgradeSymbol);
        assertEq(pxToken.balanceOf(minter1), preUpgradeBalance1);
        assertEq(pxToken.balanceOf(minter2), preUpgradeBalance2);

        // Verify critical constants are preserved
        assertEq(pxToken.INDEX_OFFSET(), INDEX_OFFSET);
        assertEq(pxToken.SHIBA_WIDTH(), SHIBA_WIDTH);
        assertEq(pxToken.SHIBA_HEIGHT(), SHIBA_HEIGHT);

        // Verify all existing tokens still have correct owners
        _verifyTokenOwnership();

        console.log("  All storage layout preserved after upgrade");
        console.log("  Post-upgrade verification complete");
    }

    function test_FunctionalityAfterUpgrade() public {
        console.log("Testing functionality after upgrade...");

        // Set up state and upgrade
        _setupInitialState();
        _upgrade();

        // Should have same functionality
        uint256 preBalance = pxToken.balanceOf(minter1);
        uint256 preRemaining = pxToken.puppersRemaining();

        // Test minting still works after upgrade
        vm.prank(minter1);
        pxToken.mintPuppers(2, address(dogToken));

        assertEq(pxToken.balanceOf(minter1), preBalance + 2);
        assertEq(pxToken.puppersRemaining(), preRemaining - 2);

        console.log("  Functionality working correctly after upgrade");
        console.log("  Minting works after upgrade");
    }

    function test_BurnReturns100Percent() public {
        console.log("Testing burn returns 100% of locked tokens...");

        // Set up state
        _setupInitialState();

        // Get minter1's token IDs
        uint256 minter1Balance = pxToken.balanceOf(minter1);
        assertTrue(minter1Balance > 0, "Minter1 should have tokens");

        // Find a token owned by minter1
        uint256 tokenToBurn = 0;
        for (uint256 i = INDEX_OFFSET; i < INDEX_OFFSET + TOTAL_SUPPLY; i++) {
            try pxToken.ownerOf(i) returns (address tokenOwner) {
                if (tokenOwner == minter1) {
                    tokenToBurn = i;
                    break;
                }
            } catch {}
        }
        assertTrue(tokenToBurn != 0, "Should find a token to burn");

        // Get the lock amount for this token
        (address lockToken, uint256 lockAmount) = pxToken.pixelLocks(tokenToBurn);
        assertEq(lockToken, address(dogToken), "Lock token should be DOG token");
        assertEq(lockAmount, DOG_TO_PIXEL_SATOSHIS, "Lock amount should match");

        // Record balances before burn
        uint256 minter1DogBefore = dogToken.balanceOf(minter1);
        uint256 contractDogBefore = dogToken.balanceOf(address(proxy));

        // Burn the token
        uint256[] memory tokensToBurn = new uint256[](1);
        tokensToBurn[0] = tokenToBurn;

        vm.prank(minter1);
        pxToken.burnPuppers(tokensToBurn);

        // Verify 100% of locked tokens returned (no dev fee)
        uint256 minter1DogAfter = dogToken.balanceOf(minter1);
        uint256 contractDogAfter = dogToken.balanceOf(address(proxy));

        // Minter should receive exactly 100% of lock amount
        assertEq(minter1DogAfter - minter1DogBefore, lockAmount, "Minter should receive 100% of lock amount");

        // Contract balance should decrease by exactly lock amount
        assertEq(contractDogBefore - contractDogAfter, lockAmount, "Contract should transfer exactly lock amount");

        console.log("  Burn returns 100% verified");
        console.log("  Lock amount:", lockAmount);
        console.log("  Amount returned to burner:", minter1DogAfter - minter1DogBefore);
    }

    function test_MultipleUpgrades() public {
        console.log("Testing multiple upgrades...");

        // Set up initial state
        _setupInitialState();

        uint256 initialBalance1 = pxToken.balanceOf(minter1);
        uint256 initialBalance2 = pxToken.balanceOf(minter2);
        uint256 initialRemaining = pxToken.puppersRemaining();

        // First upgrade
        _upgrade();

        // Mint after first upgrade
        vm.prank(minter2);
        pxToken.mintPuppers(2, address(dogToken));

        uint256 afterFirstUpgradeBalance = pxToken.balanceOf(minter2);
        assertEq(afterFirstUpgradeBalance, initialBalance2 + 2);

        // Second upgrade
        PXV3 newImplementation = new PXV3();
        UUPSUpgradeable(address(proxy)).upgradeToAndCall(address(newImplementation), "");

        // Verify state is preserved across both upgrades
        assertEq(pxToken.balanceOf(minter1), initialBalance1);
        assertEq(pxToken.puppersRemaining(), initialRemaining - 2);

        console.log("  Multiple upgrades completed successfully");
        console.log("  State preserved across multiple upgrades");
    }

    function test_UpgradeSecurityChecks() public {
        console.log("Testing upgrade security checks...");

        // Test: Cannot upgrade to zero address
        vm.expectRevert();
        UUPSUpgradeable(address(proxy)).upgradeToAndCall(address(0), "");

        // Test: Cannot upgrade to non-contract address
        vm.expectRevert();
        UUPSUpgradeable(address(proxy))
            .upgradeToAndCall(
                attacker, // EOA address
                ""
            );

        // Test: Upgrading to current implementation should work (not an error)
        address currentImpl = _getImplementationAddress();
        UUPSUpgradeable(address(proxy)).upgradeToAndCall(currentImpl, "");
        // Verify it's still the same implementation
        assertEq(_getImplementationAddress(), currentImpl);

        console.log("  Security checks passed");
        console.log("  Invalid upgrade attempts properly rejected");
    }

    function test_ContractOwnershipTransfer() public {
        console.log("Testing contract ownership transfer...");

        address newAdmin = makeAddr("newAdmin");

        // Verify initial state
        assertTrue(pxToken.hasRole(pxToken.DEFAULT_ADMIN_ROLE(), owner));

        // Grant admin role to new admin
        pxToken.grantRole(pxToken.DEFAULT_ADMIN_ROLE(), newAdmin);
        // Revoke admin role from old owner
        pxToken.revokeRole(pxToken.DEFAULT_ADMIN_ROLE(), owner);

        assertTrue(pxToken.hasRole(pxToken.DEFAULT_ADMIN_ROLE(), newAdmin));
        assertFalse(pxToken.hasRole(pxToken.DEFAULT_ADMIN_ROLE(), owner));

        // Old admin can no longer upgrade
        PXV3 newImplementation = new PXV3();
        vm.startPrank(owner);
        vm.expectRevert(
            abi.encodeWithSignature(
                "AccessControlUnauthorizedAccount(address,bytes32)", owner, pxToken.DEFAULT_ADMIN_ROLE()
            )
        );
        UUPSUpgradeable(address(proxy)).upgradeToAndCall(address(newImplementation), "");
        vm.stopPrank();

        // New admin can upgrade
        vm.prank(newAdmin);
        UUPSUpgradeable(address(proxy)).upgradeToAndCall(address(newImplementation), "");

        console.log("  Ownership transfer successful");
        console.log("  Access control transferred correctly");
    }

    // Helper functions

    function _setupInitialState() internal {
        // Enable minting (one-way switch)
        pxToken.startMinting();

        // Mint some tokens to create state
        vm.prank(minter1);
        pxToken.mintPuppers(3, address(dogToken));

        vm.prank(minter2);
        pxToken.mintPuppers(2, address(dogToken));

        console.log("  Initial state created:");
        console.log("    Minter1 tokens:", pxToken.balanceOf(minter1));
        console.log("    Minter2 tokens:", pxToken.balanceOf(minter2));
        console.log("    Remaining:", pxToken.puppersRemaining());
    }

    function _upgrade() internal {
        // Deploy new PXV3 implementation
        PXV3 newImplementation = new PXV3();

        // Perform upgrade using UUPS
        UUPSUpgradeable(address(proxy)).upgradeToAndCall(address(newImplementation), "");

        // Verify upgrade
        _verifyImplementationAddress(address(newImplementation));

        console.log("  Upgraded to new implementation");
    }

    function _verifyImplementationAddress(address expectedImpl) internal view {
        // Get implementation address from storage slot
        bytes32 implSlot = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);
        address actualImpl = address(uint160(uint256(vm.load(address(proxy), implSlot))));

        assertEq(actualImpl, expectedImpl, "Implementation address mismatch");
    }

    function _getImplementationAddress() internal view returns (address) {
        bytes32 implSlot = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);
        return address(uint160(uint256(vm.load(address(proxy), implSlot))));
    }

    function _verifyTokenOwnership() internal view {
        // Verify existing tokens still have correct owners
        for (uint256 i = 0; i < 10; i++) {
            // Check first 10 tokens
            uint256 tokenId = INDEX_OFFSET + i;
            try pxToken.ownerOf(tokenId) returns (address tokenOwner) {
                // Token exists, verify owner is either minter1 or minter2
                assertTrue(tokenOwner == minter1 || tokenOwner == minter2, "Token ownership corrupted during upgrade");
            } catch {
                // Token doesn't exist, which is fine
            }
        }
    }

    // Tests for getReservedTokensForUser function

    function test_GetReservedTokensForUser_BasicFunctionality() public {
        // Pause for reservations (need to pause since setUp unpauses)
        pxToken.pause();

        // Reserve tokens for different users
        uint256[] memory tokenIds = new uint256[](4);
        tokenIds[0] = INDEX_OFFSET + 1;
        tokenIds[1] = INDEX_OFFSET + 2;
        tokenIds[2] = INDEX_OFFSET + 3;
        tokenIds[3] = INDEX_OFFSET + 4;

        address[] memory recipients = new address[](4);
        recipients[0] = minter1;
        recipients[1] = minter2;
        recipients[2] = minter1;
        recipients[3] = minter1;

        pxToken.reserveTokensForMigration(tokenIds, recipients);

        // Set burn flags for some tokens
        uint256[] memory burnTokenIds = new uint256[](2);
        burnTokenIds[0] = tokenIds[0];
        burnTokenIds[1] = tokenIds[3];
        bool[] memory burnStatuses = new bool[](2);
        burnStatuses[0] = true;
        burnStatuses[1] = true;
        pxToken.setBurnFlags(burnTokenIds, burnStatuses);

        // Query minter1's reservations
        uint256[] memory queryIds = new uint256[](4);
        queryIds[0] = tokenIds[0];
        queryIds[1] = tokenIds[1];
        queryIds[2] = tokenIds[2];
        queryIds[3] = tokenIds[3];

        (uint256[] memory resultTokenIds, bool[] memory resultBurnConfirmed) =
            pxToken.getReservedTokensForUser(minter1, queryIds);

        // Should return 3 tokens (tokenIds[0], [2], [3] are for minter1)
        assertEq(resultTokenIds.length, 3, "Should return 3 tokens for minter1");
        assertEq(resultBurnConfirmed.length, 3, "Burn confirmed array should match");

        // Verify returned tokens
        assertEq(resultTokenIds[0], tokenIds[0]);
        assertEq(resultTokenIds[1], tokenIds[2]);
        assertEq(resultTokenIds[2], tokenIds[3]);

        // Verify burn flags
        assertTrue(resultBurnConfirmed[0], "Token 0 should have burn confirmed");
        assertFalse(resultBurnConfirmed[1], "Token 2 should not have burn confirmed");
        assertTrue(resultBurnConfirmed[2], "Token 3 should have burn confirmed");
    }

    function test_GetReservedTokensForUser_FiltersOtherUsers() public {
        pxToken.pause();

        // Reserve all tokens for minter2
        uint256[] memory tokenIds = new uint256[](3);
        tokenIds[0] = INDEX_OFFSET + 10;
        tokenIds[1] = INDEX_OFFSET + 11;
        tokenIds[2] = INDEX_OFFSET + 12;

        address[] memory recipients = new address[](3);
        recipients[0] = minter2;
        recipients[1] = minter2;
        recipients[2] = minter2;

        pxToken.reserveTokensForMigration(tokenIds, recipients);

        // Query as minter1 - should return empty
        (uint256[] memory resultTokenIds, bool[] memory resultBurnConfirmed) =
            pxToken.getReservedTokensForUser(minter1, tokenIds);

        assertEq(resultTokenIds.length, 0, "Should return 0 tokens for minter1");
        assertEq(resultBurnConfirmed.length, 0, "Burn confirmed array should be empty");
    }

    function test_GetReservedTokensForUser_NonReservedTokens() public {
        pxToken.pause();

        // Reserve only one token
        uint256[] memory reserveIds = new uint256[](1);
        reserveIds[0] = INDEX_OFFSET + 20;
        address[] memory recipients = new address[](1);
        recipients[0] = minter1;

        pxToken.reserveTokensForMigration(reserveIds, recipients);

        // Query with mix of reserved and non-reserved tokens
        uint256[] memory queryIds = new uint256[](3);
        queryIds[0] = INDEX_OFFSET + 19; // Not reserved
        queryIds[1] = INDEX_OFFSET + 20; // Reserved for minter1
        queryIds[2] = INDEX_OFFSET + 21; // Not reserved

        (uint256[] memory resultTokenIds, bool[] memory resultBurnConfirmed) =
            pxToken.getReservedTokensForUser(minter1, queryIds);

        // Should only return the one reserved token
        assertEq(resultTokenIds.length, 1, "Should return 1 token");
        assertEq(resultTokenIds[0], INDEX_OFFSET + 20);
        assertFalse(resultBurnConfirmed[0], "Burn not confirmed");
    }

    function test_GetReservedTokensForUser_EmptyInput() public {
        // Query with empty array
        uint256[] memory emptyIds = new uint256[](0);

        (uint256[] memory resultTokenIds, bool[] memory resultBurnConfirmed) =
            pxToken.getReservedTokensForUser(minter1, emptyIds);

        assertEq(resultTokenIds.length, 0, "Should return empty array");
        assertEq(resultBurnConfirmed.length, 0, "Burn confirmed should be empty");
    }

    function test_GetReservedTokensForUser_InvalidUserReverts() public {
        uint256[] memory queryIds = new uint256[](1);
        queryIds[0] = INDEX_OFFSET + 1;

        // Should revert with InvalidRecipient for zero address
        vm.expectRevert(abi.encodeWithSignature("InvalidRecipient()"));
        pxToken.getReservedTokensForUser(address(0), queryIds);
    }

    function test_GetReservedTokensForUser_AfterClaim() public {
        pxToken.pause();

        // Reserve tokens
        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = INDEX_OFFSET + 30;
        tokenIds[1] = INDEX_OFFSET + 31;

        address[] memory recipients = new address[](2);
        recipients[0] = minter1;
        recipients[1] = minter1;

        pxToken.reserveTokensForMigration(tokenIds, recipients);

        // Set burn flags
        bool[] memory burnStatuses = new bool[](2);
        burnStatuses[0] = true;
        burnStatuses[1] = true;
        pxToken.setBurnFlags(tokenIds, burnStatuses);

        // Unpause and claim one token
        pxToken.unpause();
        vm.prank(minter1);
        pxToken.claimReservedToken(tokenIds[0], address(dogToken));

        // Query both tokens - only unclaimed one should be returned
        (uint256[] memory resultTokenIds, bool[] memory resultBurnConfirmed) =
            pxToken.getReservedTokensForUser(minter1, tokenIds);

        assertEq(resultTokenIds.length, 1, "Should return 1 token after claim");
        assertEq(resultTokenIds[0], tokenIds[1], "Should return unclaimed token");
        assertTrue(resultBurnConfirmed[0], "Burn should be confirmed");
    }
}
