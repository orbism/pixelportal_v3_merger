// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {PX} from "../src/PX.sol";
import {PXV2} from "../src/PXV2.sol";
import {MockDOG20} from "./mocks/MockDOG20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title PXUpgrade
 * @dev Comprehensive upgrade tests for PX contract using UUPS pattern
 *
 * Test Coverage:
 * 1. UUPS upgrade access control (only owner can upgrade)
 * 2. Storage layout preservation during upgrades
 * 3. Functional upgrade from PX to PXV2
 * 4. State preservation across upgrades
 */
contract PXUpgrade is Test {
    PX public pxTokenV1;
    PXV2 public pxTokenV2;
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

        // Deploy PX V1 implementation
        PX implementationV1 = new PX();

        // Prepare initialization data
        bytes memory initData = abi.encodeWithSelector(
            PX.__PX_init.selector,
            "Pixel Token V1",
            "PXV1",
            address(dogToken),
            "ipfs://v1-uri/",
            SHIBA_WIDTH,
            SHIBA_HEIGHT,
            devFeeAddress,
            owner // owner parameter for UUPS
        );

        // Deploy UUPS proxy with V1 implementation
        proxy = new ERC1967Proxy(address(implementationV1), initData);

        // Cast proxy to PX interface for V1
        pxTokenV1 = PX(address(proxy));

        // Set up DOG tokens for testing
        uint256 dogAmount = DOG_TO_PIXEL_SATOSHIS * 50;
        dogToken.mint(minter1, dogAmount);
        dogToken.mint(minter2, dogAmount);

        // Approve spending
        vm.prank(minter1);
        dogToken.approve(address(proxy), type(uint256).max);
        vm.prank(minter2);
        dogToken.approve(address(proxy), type(uint256).max);

        // Unpause for testing
        pxTokenV1.unpause();

        // Configure DOG20 token for locking (required for new token lock system)
        pxTokenV1.setTokenLockAmount(address(dogToken), DOG_TO_PIXEL_SATOSHIS);
    }

    function test_UUPSAccessControl() public {
        console.log("Testing UUPS access control...");

        // Deploy V2 implementation
        PXV2 implementationV2 = new PXV2();

        // Verify initial state
        assertTrue(pxTokenV1.hasRole(pxTokenV1.DEFAULT_ADMIN_ROLE(), owner));

        // Test: Non-admin cannot upgrade
        vm.startPrank(attacker);
        vm.expectRevert(
            abi.encodeWithSignature(
                "AccessControlUnauthorizedAccount(address,bytes32)", attacker, pxTokenV1.DEFAULT_ADMIN_ROLE()
            )
        );
        UUPSUpgradeable(address(proxy)).upgradeToAndCall(address(implementationV2), "");
        vm.stopPrank();

        // Test: Owner can upgrade
        UUPSUpgradeable(address(proxy)).upgradeToAndCall(address(implementationV2), "");

        // Verify upgrade was successful
        _verifyImplementationAddress(address(implementationV2));

        console.log("  Access control tests passed");
        console.log("  Only contract owner can perform UUPS upgrades");
    }

    function test_StorageLayoutPreservation() public {
        console.log("Testing storage layout preservation...");

        // Create initial state in V1
        _setupInitialV1State();

        // Record pre-upgrade state
        uint256 preUpgradePuppersRemaining = pxTokenV1.puppersRemaining();
        uint256 preUpgradeTotalSupply = pxTokenV1.totalSupply();
        bool preUpgradeHasAdminRole = pxTokenV1.hasRole(pxTokenV1.DEFAULT_ADMIN_ROLE(), owner);
        string memory preUpgradeName = pxTokenV1.name();
        string memory preUpgradeSymbol = pxTokenV1.symbol();
        uint256 preUpgradeBalance1 = pxTokenV1.balanceOf(minter1);
        uint256 preUpgradeBalance2 = pxTokenV1.balanceOf(minter2);

        console.log("  Pre-upgrade state recorded:");
        console.log("    Puppers remaining:", preUpgradePuppersRemaining);
        console.log("    Minter1 balance:", preUpgradeBalance1);
        console.log("    Minter2 balance:", preUpgradeBalance2);

        // Perform upgrade to V2
        _upgradeToV2();

        // Cast to V2 interface
        pxTokenV2 = PXV2(address(proxy));

        // Verify all V1 storage is preserved
        assertEq(pxTokenV2.puppersRemaining(), preUpgradePuppersRemaining);
        assertEq(pxTokenV2.totalSupply(), preUpgradeTotalSupply);
        assertEq(pxTokenV2.hasRole(pxTokenV2.DEFAULT_ADMIN_ROLE(), owner), preUpgradeHasAdminRole);
        assertEq(pxTokenV2.name(), preUpgradeName);
        assertEq(pxTokenV2.symbol(), preUpgradeSymbol);
        assertEq(pxTokenV2.balanceOf(minter1), preUpgradeBalance1);
        assertEq(pxTokenV2.balanceOf(minter2), preUpgradeBalance2);

        // Verify critical constants are preserved
        assertEq(pxTokenV2.INDEX_OFFSET(), INDEX_OFFSET);
        assertEq(pxTokenV2.SHIBA_WIDTH(), SHIBA_WIDTH);
        assertEq(pxTokenV2.SHIBA_HEIGHT(), SHIBA_HEIGHT);

        // Verify all existing tokens still have correct owners
        _verifyTokenOwnership();

        console.log("  All storage layout preserved after upgrade");
        console.log("  Post-upgrade verification complete");
    }

    function test_V2FunctionalityAfterUpgrade() public {
        console.log("Testing V2 functionality after upgrade...");

        // Set up state and upgrade
        _setupInitialV1State();
        _upgradeToV2();
        pxTokenV2 = PXV2(address(proxy));

        // V2 requires startMinting() before minting can work
        pxTokenV2.startMinting();

        // V2 should have same functionality as V1
        uint256 preBalance = pxTokenV2.balanceOf(minter1);
        uint256 preRemaining = pxTokenV2.puppersRemaining();

        // Test minting still works after upgrade
        vm.prank(minter1);
        pxTokenV2.mintPuppers(2, address(dogToken));

        assertEq(pxTokenV2.balanceOf(minter1), preBalance + 2);
        assertEq(pxTokenV2.puppersRemaining(), preRemaining - 2);

        console.log("  V2 functionality working correctly");
        console.log("  Minting works after upgrade");
    }

    function test_V2BurnReturns100Percent() public {
        console.log("Testing V2 burn returns 100% of locked tokens...");

        // Set up state and upgrade
        _setupInitialV1State();
        _upgradeToV2();
        pxTokenV2 = PXV2(address(proxy));

        // Get minter1's token IDs
        uint256 minter1Balance = pxTokenV2.balanceOf(minter1);
        assertTrue(minter1Balance > 0, "Minter1 should have tokens");

        // Find a token owned by minter1
        uint256 tokenToBurn = 0;
        for (uint256 i = INDEX_OFFSET; i < INDEX_OFFSET + TOTAL_SUPPLY; i++) {
            try pxTokenV2.ownerOf(i) returns (address tokenOwner) {
                if (tokenOwner == minter1) {
                    tokenToBurn = i;
                    break;
                }
            } catch {}
        }
        assertTrue(tokenToBurn != 0, "Should find a token to burn");

        // Get the lock amount for this token
        (address lockToken, uint256 lockAmount) = pxTokenV2.pixelLocks(tokenToBurn);
        assertEq(lockToken, address(dogToken), "Lock token should be DOG token");
        assertEq(lockAmount, DOG_TO_PIXEL_SATOSHIS, "Lock amount should match");

        // Record balances before burn
        uint256 minter1DogBefore = dogToken.balanceOf(minter1);
        uint256 contractDogBefore = dogToken.balanceOf(address(proxy));

        // Burn the token
        uint256[] memory tokensToBurn = new uint256[](1);
        tokensToBurn[0] = tokenToBurn;

        vm.prank(minter1);
        pxTokenV2.burnPuppers(tokensToBurn);

        // Verify 100% of locked tokens returned (no dev fee)
        uint256 minter1DogAfter = dogToken.balanceOf(minter1);
        uint256 contractDogAfter = dogToken.balanceOf(address(proxy));

        // Minter should receive exactly 100% of lock amount
        assertEq(minter1DogAfter - minter1DogBefore, lockAmount, "Minter should receive 100% of lock amount");

        // Contract balance should decrease by exactly lock amount
        assertEq(contractDogBefore - contractDogAfter, lockAmount, "Contract should transfer exactly lock amount");

        console.log("  V2 burn returns 100% verified");
        console.log("  Lock amount:", lockAmount);
        console.log("  Amount returned to burner:", minter1DogAfter - minter1DogBefore);
    }

    function test_V2VsV1BurnFeeComparison() public {
        console.log("Testing V2 vs V1 burn fee comparison...");

        // First test V1 behavior (1% dev fee)
        vm.prank(minter1);
        pxTokenV1.mintPuppers(1, address(dogToken));

        // Find minter1's token
        uint256 v1Token = 0;
        for (uint256 i = INDEX_OFFSET; i < INDEX_OFFSET + TOTAL_SUPPLY; i++) {
            try pxTokenV1.ownerOf(i) returns (address tokenOwner) {
                if (tokenOwner == minter1) {
                    v1Token = i;
                    break;
                }
            } catch {}
        }

        (, uint256 v1LockAmount) = pxTokenV1.pixelLocks(v1Token);
        uint256 minter1DogBeforeV1 = dogToken.balanceOf(minter1);
        uint256 devFeeBefore = dogToken.balanceOf(devFeeAddress);

        uint256[] memory v1TokensToBurn = new uint256[](1);
        v1TokensToBurn[0] = v1Token;

        vm.prank(minter1);
        pxTokenV1.burnPuppers(v1TokensToBurn);

        uint256 minter1DogAfterV1 = dogToken.balanceOf(minter1);
        uint256 devFeeAfter = dogToken.balanceOf(devFeeAddress);

        uint256 v1ReturnedToMinter = minter1DogAfterV1 - minter1DogBeforeV1;
        uint256 v1DevFee = devFeeAfter - devFeeBefore;

        // V1 should take 1% dev fee
        assertEq(v1DevFee, v1LockAmount / 100, "V1 should take 1% dev fee");
        assertEq(v1ReturnedToMinter, v1LockAmount - v1DevFee, "V1 should return 99% to minter");

        console.log("  V1 lock amount:", v1LockAmount);
        console.log("  V1 dev fee (1%):", v1DevFee);
        console.log("  V1 returned to minter (99%):", v1ReturnedToMinter);

        // Now upgrade to V2 and test
        _upgradeToV2();
        pxTokenV2 = PXV2(address(proxy));

        // V2 requires startMinting() before minting can work
        pxTokenV2.startMinting();

        // Mint a new token in V2
        vm.prank(minter2);
        pxTokenV2.mintPuppers(1, address(dogToken));

        // Find minter2's token
        uint256 v2Token = 0;
        for (uint256 i = INDEX_OFFSET; i < INDEX_OFFSET + TOTAL_SUPPLY; i++) {
            try pxTokenV2.ownerOf(i) returns (address tokenOwner) {
                if (tokenOwner == minter2) {
                    v2Token = i;
                    break;
                }
            } catch {}
        }

        (, uint256 v2LockAmount) = pxTokenV2.pixelLocks(v2Token);
        uint256 minter2DogBeforeV2 = dogToken.balanceOf(minter2);
        uint256 devFeeBeforeV2 = dogToken.balanceOf(devFeeAddress);

        uint256[] memory v2TokensToBurn = new uint256[](1);
        v2TokensToBurn[0] = v2Token;

        vm.prank(minter2);
        pxTokenV2.burnPuppers(v2TokensToBurn);

        uint256 minter2DogAfterV2 = dogToken.balanceOf(minter2);
        uint256 devFeeAfterV2 = dogToken.balanceOf(devFeeAddress);

        uint256 v2ReturnedToMinter = minter2DogAfterV2 - minter2DogBeforeV2;
        uint256 v2DevFee = devFeeAfterV2 - devFeeBeforeV2;

        // V2 should NOT take any dev fee
        assertEq(v2DevFee, 0, "V2 should NOT take any dev fee");
        assertEq(v2ReturnedToMinter, v2LockAmount, "V2 should return 100% to minter");

        console.log("  V2 lock amount:", v2LockAmount);
        console.log("  V2 dev fee (0%):", v2DevFee);
        console.log("  V2 returned to minter (100%):", v2ReturnedToMinter);

        // Compare: V2 returns more than V1
        assertGt(v2ReturnedToMinter, v1ReturnedToMinter, "V2 should return more than V1");

        console.log("  V2 returns", v2ReturnedToMinter - v1ReturnedToMinter, "more than V1");
    }

    function test_MultipleUpgrades() public {
        console.log("Testing multiple upgrades...");

        // Set up initial state
        _setupInitialV1State();

        uint256 initialBalance1 = pxTokenV1.balanceOf(minter1);
        uint256 initialBalance2 = pxTokenV1.balanceOf(minter2);
        uint256 initialRemaining = pxTokenV1.puppersRemaining();

        // First upgrade: V1 -> V2
        _upgradeToV2();
        pxTokenV2 = PXV2(address(proxy));

        // V2 requires startMinting() before minting can work
        pxTokenV2.startMinting();

        // Use V2 (same as V1)
        vm.prank(minter2);
        pxTokenV2.mintPuppers(2, address(dogToken));

        uint256 afterV2Balance = pxTokenV2.balanceOf(minter2);
        assertEq(afterV2Balance, initialBalance2 + 2);

        // Second upgrade: V2 -> V1 (downgrade for testing)
        PX newV1Implementation = new PX();
        UUPSUpgradeable(address(proxy)).upgradeToAndCall(address(newV1Implementation), "");

        // Cast back to V1 interface
        PX downgradedPX = PX(address(proxy));

        // Verify state is preserved even across downgrade
        assertEq(downgradedPX.balanceOf(minter1), initialBalance1);
        assertEq(downgradedPX.puppersRemaining(), initialRemaining - 2);

        console.log("  Multiple upgrades completed successfully");
        console.log("  State preserved across upgrade/downgrade cycle");
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
        assertTrue(pxTokenV1.hasRole(pxTokenV1.DEFAULT_ADMIN_ROLE(), owner));

        // Grant admin role to new admin
        pxTokenV1.grantRole(pxTokenV1.DEFAULT_ADMIN_ROLE(), newAdmin);
        // Revoke admin role from old owner
        pxTokenV1.revokeRole(pxTokenV1.DEFAULT_ADMIN_ROLE(), owner);

        assertTrue(pxTokenV1.hasRole(pxTokenV1.DEFAULT_ADMIN_ROLE(), newAdmin));
        assertFalse(pxTokenV1.hasRole(pxTokenV1.DEFAULT_ADMIN_ROLE(), owner));

        // Old admin can no longer upgrade
        PXV2 implementationV2 = new PXV2();
        vm.startPrank(owner);
        vm.expectRevert(
            abi.encodeWithSignature(
                "AccessControlUnauthorizedAccount(address,bytes32)", owner, pxTokenV1.DEFAULT_ADMIN_ROLE()
            )
        );
        UUPSUpgradeable(address(proxy)).upgradeToAndCall(address(implementationV2), "");
        vm.stopPrank();

        // New admin can upgrade
        vm.prank(newAdmin);
        UUPSUpgradeable(address(proxy)).upgradeToAndCall(address(implementationV2), "");

        console.log("  Ownership transfer successful");
        console.log("  Access control transferred correctly");
    }

    // Helper functions

    function _setupInitialV1State() internal {
        // Mint some tokens to create state
        vm.prank(minter1);
        pxTokenV1.mintPuppers(3, address(dogToken));

        vm.prank(minter2);
        pxTokenV1.mintPuppers(2, address(dogToken));

        console.log("  Initial V1 state created:");
        console.log("    Minter1 tokens:", pxTokenV1.balanceOf(minter1));
        console.log("    Minter2 tokens:", pxTokenV1.balanceOf(minter2));
        console.log("    Remaining:", pxTokenV1.puppersRemaining());
    }

    function _upgradeToV2() internal {
        // Deploy V2 implementation
        PXV2 implementationV2 = new PXV2();

        // Perform upgrade using UUPS
        UUPSUpgradeable(address(proxy)).upgradeToAndCall(address(implementationV2), "");

        // Verify upgrade
        _verifyImplementationAddress(address(implementationV2));

        console.log("  Upgraded to V2 implementation");
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
            try pxTokenV2.ownerOf(tokenId) returns (address tokenOwner) {
                // Token exists, verify owner is either minter1 or minter2
                assertTrue(tokenOwner == minter1 || tokenOwner == minter2, "Token ownership corrupted during upgrade");
            } catch {
                // Token doesn't exist, which is fine
            }
        }
    }

    // Tests for getReservedTokensForUser function

    function test_GetReservedTokensForUser_BasicFunctionality() public {
        _upgradeToV2();
        pxTokenV2 = PXV2(address(proxy));

        // Pause for reservations
        pxTokenV2.pause();

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

        pxTokenV2.reserveTokensForMigration(tokenIds, recipients);

        // Set burn flags for some tokens
        uint256[] memory burnTokenIds = new uint256[](2);
        burnTokenIds[0] = tokenIds[0];
        burnTokenIds[1] = tokenIds[3];
        bool[] memory burnStatuses = new bool[](2);
        burnStatuses[0] = true;
        burnStatuses[1] = true;
        pxTokenV2.setBurnFlags(burnTokenIds, burnStatuses);

        // Query minter1's reservations
        uint256[] memory queryIds = new uint256[](4);
        queryIds[0] = tokenIds[0];
        queryIds[1] = tokenIds[1];
        queryIds[2] = tokenIds[2];
        queryIds[3] = tokenIds[3];

        (uint256[] memory resultTokenIds, bool[] memory resultBurnConfirmed) =
            pxTokenV2.getReservedTokensForUser(minter1, queryIds);

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
        _upgradeToV2();
        pxTokenV2 = PXV2(address(proxy));
        pxTokenV2.pause();

        // Reserve all tokens for minter2
        uint256[] memory tokenIds = new uint256[](3);
        tokenIds[0] = INDEX_OFFSET + 10;
        tokenIds[1] = INDEX_OFFSET + 11;
        tokenIds[2] = INDEX_OFFSET + 12;

        address[] memory recipients = new address[](3);
        recipients[0] = minter2;
        recipients[1] = minter2;
        recipients[2] = minter2;

        pxTokenV2.reserveTokensForMigration(tokenIds, recipients);

        // Query as minter1 - should return empty
        (uint256[] memory resultTokenIds, bool[] memory resultBurnConfirmed) =
            pxTokenV2.getReservedTokensForUser(minter1, tokenIds);

        assertEq(resultTokenIds.length, 0, "Should return 0 tokens for minter1");
        assertEq(resultBurnConfirmed.length, 0, "Burn confirmed array should be empty");
    }

    function test_GetReservedTokensForUser_NonReservedTokens() public {
        _upgradeToV2();
        pxTokenV2 = PXV2(address(proxy));
        pxTokenV2.pause();

        // Reserve only one token
        uint256[] memory reserveIds = new uint256[](1);
        reserveIds[0] = INDEX_OFFSET + 20;
        address[] memory recipients = new address[](1);
        recipients[0] = minter1;

        pxTokenV2.reserveTokensForMigration(reserveIds, recipients);

        // Query with mix of reserved and non-reserved tokens
        uint256[] memory queryIds = new uint256[](3);
        queryIds[0] = INDEX_OFFSET + 19; // Not reserved
        queryIds[1] = INDEX_OFFSET + 20; // Reserved for minter1
        queryIds[2] = INDEX_OFFSET + 21; // Not reserved

        (uint256[] memory resultTokenIds, bool[] memory resultBurnConfirmed) =
            pxTokenV2.getReservedTokensForUser(minter1, queryIds);

        // Should only return the one reserved token
        assertEq(resultTokenIds.length, 1, "Should return 1 token");
        assertEq(resultTokenIds[0], INDEX_OFFSET + 20);
        assertFalse(resultBurnConfirmed[0], "Burn not confirmed");
    }

    function test_GetReservedTokensForUser_EmptyInput() public {
        _upgradeToV2();
        pxTokenV2 = PXV2(address(proxy));

        // Query with empty array
        uint256[] memory emptyIds = new uint256[](0);

        (uint256[] memory resultTokenIds, bool[] memory resultBurnConfirmed) =
            pxTokenV2.getReservedTokensForUser(minter1, emptyIds);

        assertEq(resultTokenIds.length, 0, "Should return empty array");
        assertEq(resultBurnConfirmed.length, 0, "Burn confirmed should be empty");
    }

    function test_GetReservedTokensForUser_InvalidUserReverts() public {
        _upgradeToV2();
        pxTokenV2 = PXV2(address(proxy));

        uint256[] memory queryIds = new uint256[](1);
        queryIds[0] = INDEX_OFFSET + 1;

        // Should revert with InvalidRecipient for zero address
        vm.expectRevert(abi.encodeWithSignature("InvalidRecipient()"));
        pxTokenV2.getReservedTokensForUser(address(0), queryIds);
    }

    function test_GetReservedTokensForUser_AfterClaim() public {
        _upgradeToV2();
        pxTokenV2 = PXV2(address(proxy));
        pxTokenV2.pause();

        // Reserve tokens
        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = INDEX_OFFSET + 30;
        tokenIds[1] = INDEX_OFFSET + 31;

        address[] memory recipients = new address[](2);
        recipients[0] = minter1;
        recipients[1] = minter1;

        pxTokenV2.reserveTokensForMigration(tokenIds, recipients);

        // Set burn flags
        bool[] memory burnStatuses = new bool[](2);
        burnStatuses[0] = true;
        burnStatuses[1] = true;
        pxTokenV2.setBurnFlags(tokenIds, burnStatuses);

        // Unpause and claim one token
        pxTokenV2.unpause();
        vm.prank(minter1);
        pxTokenV2.claimReservedToken(tokenIds[0], address(dogToken));

        // Query both tokens - only unclaimed one should be returned
        (uint256[] memory resultTokenIds, bool[] memory resultBurnConfirmed) =
            pxTokenV2.getReservedTokensForUser(minter1, tokenIds);

        assertEq(resultTokenIds.length, 1, "Should return 1 token after claim");
        assertEq(resultTokenIds[0], tokenIds[1], "Should return unclaimed token");
        assertTrue(resultBurnConfirmed[0], "Burn should be confirmed");
    }
}
