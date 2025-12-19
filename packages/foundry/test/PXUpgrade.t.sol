// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
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
 * 5. New functionality in upgraded contract
 * 6. Upgrade reversal and multiple upgrades
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

        // Verify critical V1 constants are preserved
        assertEq(pxTokenV2.DOG_TO_PIXEL_SATOSHIS(), DOG_TO_PIXEL_SATOSHIS);
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

        // Initialize V2 features
        uint256 maxMintPerTx = 5;
        string memory description = "Upgraded PX with enhanced features";
        uint256 mintCooldown = 3600; // 1 hour

        pxTokenV2.initializeV2(maxMintPerTx, description, mintCooldown);

        // Advance time to clear any cooldowns from V1 activity
        // Reset to a clean timestamp to avoid timing issues
        vm.warp(10000);

        // Test new V2 functionality
        assertEq(pxTokenV2.maxMintPerTx(), maxMintPerTx);
        assertEq(pxTokenV2.description(), description);
        assertEq(pxTokenV2.mintCooldown(), mintCooldown);
        assertFalse(pxTokenV2.emergencyWithdrawalEnabled());
        assertEq(pxTokenV2.version(), "2.0.0");

        // Test enhanced metadata function
        (string memory name, string memory symbol, string memory desc, uint256 supply, uint256 remaining) =
            pxTokenV2.getMetadata();

        assertEq(name, "Pixel Token V1");
        assertEq(symbol, "PXV1");
        assertEq(desc, description);
        assertEq(supply, TOTAL_SUPPLY);
        assertTrue(remaining > 0);

        // Test batch minting (new V2 feature)
        uint256 batchSize = 3;
        uint256 puppersRemainingBefore = pxTokenV2.puppersRemaining();

        // Use minter2 who hasn't minted yet (no cooldown)
        vm.prank(minter2);
        pxTokenV2.batchMintPuppers(batchSize);

        // Check balances: minter2 had previous V1 balance + new batch mint
        uint256 expectedMinter2Balance = 2 + batchSize; // 2 from V1 setup + 3 from batch
        assertEq(pxTokenV2.balanceOf(minter2), expectedMinter2Balance);
        assertEq(pxTokenV2.puppersRemaining(), puppersRemainingBefore - batchSize);

        // Test cooldown functionality
        assertTrue(pxTokenV2.canMint(minter1)); // minter1 hasn't minted in V2 yet
        assertFalse(pxTokenV2.canMint(minter2)); // minter2 just minted, on cooldown

        // Test cooldown bypass by advancing time
        vm.warp(10000 + mintCooldown + 1);
        assertTrue(pxTokenV2.canMint(minter2)); // Cooldown elapsed for minter2

        console.log("  V2 functionality working correctly");
        console.log("  Batch minting:", batchSize, "tokens");
        console.log("  Cooldown system operational");
    }

    function test_AdminFunctionality() public {
        console.log("Testing V2 admin functionality...");

        _setupInitialV1State();
        _upgradeToV2();
        pxTokenV2 = PXV2(address(proxy));

        // Initialize V2
        pxTokenV2.initializeV2(5, "Test description", 3600);

        // Test admin functions
        uint256 newLimit = 10;
        pxTokenV2.setMaxMintPerTx(newLimit);
        assertEq(pxTokenV2.maxMintPerTx(), newLimit);

        string memory newDescription = "Updated description";
        pxTokenV2.setDescription(newDescription);
        assertEq(pxTokenV2.description(), newDescription);

        uint256 newCooldown = 7200; // 2 hours
        pxTokenV2.setMintCooldown(newCooldown);
        assertEq(pxTokenV2.mintCooldown(), newCooldown);

        // Test emergency withdrawal (one-way enable)
        assertFalse(pxTokenV2.emergencyWithdrawalEnabled());
        pxTokenV2.enableEmergencyWithdrawal();
        assertTrue(pxTokenV2.emergencyWithdrawalEnabled());

        // Test non-admin cannot use admin functions
        vm.startPrank(attacker);
        vm.expectRevert(
            abi.encodeWithSignature(
                "AccessControlUnauthorizedAccount(address,bytes32)", attacker, pxTokenV2.DEFAULT_ADMIN_ROLE()
            )
        );
        pxTokenV2.setMaxMintPerTx(1);
        vm.stopPrank();

        console.log("  Admin functions working correctly");
        console.log("  Access control enforced for V2 features");
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
        pxTokenV2.initializeV2(5, "V2 Description", 3600);

        // Advance time to clear any cooldowns from V1 activity
        // Reset to a clean timestamp to avoid timing issues
        vm.warp(10000);

        // Use V2 functionality (use minter2 after clearing cooldown)
        vm.prank(minter2);
        pxTokenV2.batchMintPuppers(2);

        uint256 afterV2Balance = pxTokenV2.balanceOf(minter2);
        assertEq(afterV2Balance, initialBalance2 + 2); // minter2 had initialBalance2 (2) + 2 from V2 batch mint = 4

        // Second upgrade: V2 -> V1 (downgrade for testing)
        PX newV1Implementation = new PX();
        UUPSUpgradeable(address(proxy)).upgradeToAndCall(address(newV1Implementation), "");

        // Cast back to V1 interface
        PX downgradedPX = PX(address(proxy));

        // Verify state is preserved even across downgrade
        assertEq(downgradedPX.balanceOf(minter1), initialBalance1);
        assertEq(downgradedPX.puppersRemaining(), initialRemaining - 2); // V2 batch -2

        // V2 functions should not be available
        vm.expectRevert();
        PXV2(address(proxy)).version();

        console.log("  Multiple upgrades completed successfully");
        console.log("  State preserved across upgrade/downgrade cycle");
    }

    function test_UpgradeWithInitialization() public {
        console.log("Testing upgrade with initialization data...");

        _setupInitialV1State();

        // Deploy V2 implementation
        PXV2 implementationV2 = new PXV2();

        // Prepare initialization data for V2
        bytes memory v2InitData = abi.encodeWithSelector(
            PXV2.initializeV2.selector,
            7, // maxMintPerTx
            "Initialized during upgrade",
            1800 // mintCooldown (30 minutes)
        );

        // Upgrade with initialization
        UUPSUpgradeable(address(proxy)).upgradeToAndCall(address(implementationV2), v2InitData);

        // Verify upgrade and initialization
        pxTokenV2 = PXV2(address(proxy));
        assertEq(pxTokenV2.maxMintPerTx(), 7);
        assertEq(pxTokenV2.description(), "Initialized during upgrade");
        assertEq(pxTokenV2.mintCooldown(), 1800);

        console.log("  Upgrade with initialization successful");
        console.log("  V2 initialized with custom parameters");
    }

    function test_UpgradeSecurityChecks() public {
        console.log("Testing upgrade security checks...");

        // Test: Cannot upgrade to zero address
        vm.expectRevert();
        UUPSUpgradeable(address(proxy)).upgradeToAndCall(address(0), "");

        // Test: Cannot upgrade to non-contract address
        vm.expectRevert();
        UUPSUpgradeable(address(proxy)).upgradeToAndCall(
            attacker, // EOA address
            ""
        );

        // Test: Upgrading to current implementation should work (not an error)
        address currentImpl = _getImplementationAddress();
        // This should actually succeed, so let's not expect a revert
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

    function _verifyImplementationAddress(address expectedImpl) internal {
        // Get implementation address from storage slot
        bytes32 implSlot = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);
        address actualImpl = address(uint160(uint256(vm.load(address(proxy), implSlot))));

        assertEq(actualImpl, expectedImpl, "Implementation address mismatch");
    }

    function _getImplementationAddress() internal view returns (address) {
        bytes32 implSlot = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);
        return address(uint160(uint256(vm.load(address(proxy), implSlot))));
    }

    function _verifyTokenOwnership() internal {
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
}
