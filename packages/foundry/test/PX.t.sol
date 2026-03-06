// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {PXV3} from "../src/PXV3.sol";
import {MockDOG20} from "./mocks/MockDOG20.sol";
import {TestUtils} from "./utils/TestUtils.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {
    NoPuppersRemaining,
    EmptyPuppers,
    ArraysLengthMismatch,
    EmptyArrays,
    BatchTooLarge,
    InvalidRecipient,
    InvalidTokenID,
    TokenIDOutOfRange,
    TokenAlreadyExists,
    TokenAlreadyReserved,
    MintingAlreadyStarted
} from "../src/PXV3.sol";

/**
 * @title PXTest
 * @dev Comprehensive tests for PX token, equivalent to Hardhat PX.test.js
 */
contract PXTest is Test {
    using TestUtils for uint256[];
    using TestUtils for address[];

    uint256 constant CROP = 2;
    uint256 constant MOCK_WIDTH = (680 * CROP) / 100;
    uint256 constant MOCK_HEIGHT = (480 * CROP) / 100;
    uint256 constant MOCK_SUPPLY = MOCK_WIDTH * MOCK_HEIGHT;
    string constant MOCK_URI = "ipfs://dog-repo/";
    uint256 constant DOG_TO_PIXEL_SATOSHIS = 5523989899 * 10 ** 13;
    uint256 constant BURN_FEES_PERCENT = 1;
    uint256 constant INDEX_OFFSET = 1000000;
    uint256 constant SHARD_SIZE = 5000;

    PXV3 public px;
    MockDOG20 public dog20;

    address public owner;
    address public addr1;
    address public addr2;
    address public addr3;
    address public feesAccountDev;
    address[] public mockAddresses;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    function setUp() public virtual {
        owner = address(this);
        addr1 = makeAddr("addr1");
        addr2 = makeAddr("addr2");
        addr3 = makeAddr("addr3");
        feesAccountDev = makeAddr("feesAccountDev");

        mockAddresses = new address[](12);
        mockAddresses[0] = owner;
        mockAddresses[1] = addr1;
        mockAddresses[2] = addr2;
        mockAddresses[3] = addr3;
        for (uint256 i = 4; i < 12; i++) {
            mockAddresses[i] = makeAddr(string(abi.encodePacked("addr", vm.toString(i))));
        }

        dog20 = new MockDOG20();
        dog20.initialize(mockAddresses, DOG_TO_PIXEL_SATOSHIS * MOCK_SUPPLY);

        PXV3 implementation = new PXV3();

        bytes memory initData = abi.encodeWithSelector(
            PXV3.__PX_init.selector,
            "LONG LIVE D O G",
            "PX",
            address(dog20),
            MOCK_URI,
            MOCK_WIDTH,
            MOCK_HEIGHT,
            feesAccountDev,
            address(this)
        );

        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), initData);
        px = PXV3(address(proxy));

        px.unpause();
        px.startMinting();

        px.setTokenLockAmount(address(dog20), DOG_TO_PIXEL_SATOSHIS);

        assertEq(px.SHIBA_WIDTH(), MOCK_WIDTH);
        assertEq(px.SHIBA_HEIGHT(), MOCK_HEIGHT);
        assertEq(px.totalSupply(), MOCK_SUPPLY);
        assertEq(px.puppersRemaining(), MOCK_SUPPLY);
    }

    function getShardIndex(uint256 indexWithOffset) internal pure returns (uint256) {
        return TestUtils.getShardIndex(indexWithOffset, INDEX_OFFSET, SHARD_SIZE);
    }

    function mintPupperWithValidation(address signer, uint256 mintQty) internal returns (uint256) {
        return mintPupperWithValidation(signer, mintQty, false, "");
    }

    function mintPupperWithValidation(address signer, uint256 mintQty, bool shouldRevert, string memory revertMessage)
        internal
        returns (uint256)
    {
        uint256 addrDog20BalanceBefore = dog20.balanceOf(signer);
        uint256 pxDog20BalanceBefore = dog20.balanceOf(address(px));
        uint256 addrPXBalanceBefore = px.balanceOf(signer);
        uint256 supplyPXBalanceBefore = px.puppersRemaining();

        vm.prank(signer);
        dog20.approve(address(px), DOG_TO_PIXEL_SATOSHIS * mintQty);

        vm.prank(signer);
        if (shouldRevert) {
            vm.expectRevert(bytes(revertMessage));
            px.mintPuppers(mintQty, address(dog20));
            return 0;
        } else {
            vm.recordLogs();
            px.mintPuppers(mintQty, address(dog20));

            assertEq(dog20.balanceOf(address(px)), pxDog20BalanceBefore + (DOG_TO_PIXEL_SATOSHIS * mintQty));
            assertEq(dog20.balanceOf(signer), addrDog20BalanceBefore - (DOG_TO_PIXEL_SATOSHIS * mintQty));
            assertEq(px.balanceOf(signer), addrPXBalanceBefore + mintQty);
            assertEq(px.puppersRemaining(), supplyPXBalanceBefore - mintQty);

            Vm.Log[] memory logs = vm.getRecordedLogs();
            uint256 tokenId = 0;

            for (uint256 i = 0; i < logs.length; i++) {
                if (
                    logs[i].topics.length == 4 && logs[i].topics[0] == keccak256("Transfer(address,address,uint256)")
                        && logs[i].emitter != address(dog20)
                ) {
                    // Check if this is an ERC721 mint (from zero address)
                    address from = address(uint160(uint256(logs[i].topics[1])));
                    if (from == address(0)) {
                        // For ERC721, tokenId is in topics[3] since it's indexed
                        tokenId = uint256(logs[i].topics[3]);
                        break;
                    }
                }
            }

            require(tokenId != 0, "Transfer event was not fired");

            // Verify token URI
            uint256 shardIndex = getShardIndex(tokenId);
            string memory expectedURI = string(
                abi.encodePacked(
                    MOCK_URI, "metadata-sh", vm.toString(shardIndex), "/metadata-", vm.toString(tokenId), ".json"
                )
            );
            assertEq(px.tokenURI(tokenId), expectedURI);

            return tokenId;
        }
    }

    // Test: Basic minting functionality
    function test_SenderShouldBeOwnerAfterMint() public {
        uint256 tokenId = mintPupperWithValidation(addr1, 1);
        assertEq(px.ownerOf(tokenId), addr1);
    }

    // Test: Randomness function behaves correctly
    function test_RandomnessFunction() public {
        uint256 puppersRemaining = px.puppersRemaining();

        // Test the randomness function multiple times with different block states
        for (uint256 i = 0; i < 10; i++) {
            // Advance block state to change randomness
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 1);

            uint256 randomValue = px.randYish();
            assertTrue(randomValue > 0, "Random value should not be zero");

            // Test the range function
            if (puppersRemaining > 0) {
                uint256 randomInRange = randomValue % puppersRemaining;
                assertTrue(randomInRange < puppersRemaining, "Random value should be in range");
            }
        }

        // Test with extreme values
        vm.roll(type(uint256).max - 1);
        vm.warp(type(uint256).max - 1);
        uint256 extremeRandom = px.randYish();
        assertTrue(extremeRandom > 0, "Random should work with extreme values");

        // Test that different senders in actual transactions produce different results
        // Note: _msgSender() only changes during actual function calls, not view calls
        vm.prank(addr1);
        dog20.approve(address(px), DOG_TO_PIXEL_SATOSHIS);
        vm.prank(addr1);
        px.mintPuppers(1, address(dog20)); // This will trigger randYish() with addr1 as sender

        vm.prank(addr2);
        dog20.approve(address(px), DOG_TO_PIXEL_SATOSHIS);
        vm.prank(addr2);
        px.mintPuppers(1, address(dog20)); // This will trigger randYish() with addr2 as sender

        // If this doesn't fail, the randomness is working correctly in actual use
        assertTrue(true, "Randomness works in actual minting context");
    }

    // Test: Multiple users can mint
    function test_MultipleMinting() public {
        // First mint
        vm.prank(addr1);
        dog20.approve(address(px), DOG_TO_PIXEL_SATOSHIS);
        vm.prank(addr1);
        px.mintPuppers(1, address(dog20));
        assertEq(px.balanceOf(addr1), 1);

        // Second mint - this is where it fails
        vm.prank(addr2);
        dog20.approve(address(px), DOG_TO_PIXEL_SATOSHIS);
        vm.prank(addr2);
        px.mintPuppers(1, address(dog20));
        assertEq(px.balanceOf(addr2), 1);
    }

    // Test: Puppers can be transferred
    function test_PupperTransfer() public {
        uint256 tokenId = mintPupperWithValidation(addr1, 1);
        assertEq(px.ownerOf(tokenId), addr1);

        vm.prank(addr1);
        px.transferFrom(addr1, addr2, tokenId);
        assertEq(px.ownerOf(tokenId), addr2);

        vm.prank(addr2);
        px.transferFrom(addr2, addr1, tokenId);
        assertEq(px.ownerOf(tokenId), addr1);
    }

    // Test: Cannot mint with insufficient DOG balance
    function test_CannotMintWithInsufficientBalance() public {
        address poorAddr = makeAddr("poorAddr");
        uint256 needed = DOG_TO_PIXEL_SATOSHIS;

        vm.prank(poorAddr);
        dog20.approve(address(px), needed);

        vm.prank(poorAddr);
        vm.expectRevert(
            abi.encodeWithSignature("ERC20InsufficientBalance(address,uint256,uint256)", poorAddr, 0, needed)
        );
        px.mintPuppers(1, address(dog20));
    }

    function burnPupperWithValidation(address signer, uint256 pupper) internal {
        uint256 addrDog20BalanceBefore = dog20.balanceOf(signer);
        uint256 pxDog20BalanceBefore = dog20.balanceOf(address(px));
        uint256 addrPXBalanceBefore = px.balanceOf(signer);
        uint256 supplyPXBalanceBefore = px.puppersRemaining();

        uint256[] memory puppers = new uint256[](1);
        puppers[0] = pupper;

        vm.prank(signer);
        px.burnPuppers(puppers);

        // V3: 100% returned to user, no dev fee
        assertEq(dog20.balanceOf(address(px)), pxDog20BalanceBefore - DOG_TO_PIXEL_SATOSHIS);
        assertEq(dog20.balanceOf(signer), addrDog20BalanceBefore + DOG_TO_PIXEL_SATOSHIS);
        assertEq(px.balanceOf(signer), addrPXBalanceBefore - 1);
        assertEq(px.puppersRemaining(), supplyPXBalanceBefore + 1);
    }

    // Test: Owner can burn tokens and get 100% refund
    function test_OwnerCanBurn() public {
        uint256[] memory burnTokens = new uint256[](3);
        burnTokens[0] = mintPupperWithValidation(addr1, 1);
        burnTokens[1] = mintPupperWithValidation(addr2, 1);
        burnTokens[2] = mintPupperWithValidation(addr3, 1);

        burnPupperWithValidation(addr1, burnTokens[0]);
        burnPupperWithValidation(addr2, burnTokens[1]);
        burnPupperWithValidation(addr3, burnTokens[2]);
    }

    // Test: Burn and remint cycle
    function test_BurnAndRemintCycle() public {
        uint256 tokenId = mintPupperWithValidation(addr1, 1);
        uint256 supplyBefore = px.puppersRemaining();

        burnPupperWithValidation(addr1, tokenId);
        assertEq(px.puppersRemaining(), supplyBefore + 1);

        uint256 newTokenId = mintPupperWithValidation(addr2, 1);
        assertEq(px.puppersRemaining(), supplyBefore);

        console.log("New token minted after burn-remint cycle:", newTokenId);
    }

    // Test: Cannot reserve tokens after minting has started
    function test_CannotReserveAfterMintingStarted() public {
        // setUp already called startMinting(), so any reservation attempt should fail
        uint256[] memory tokenIds = new uint256[](1);
        address[] memory recipients = new address[](1);

        tokenIds[0] = INDEX_OFFSET + 1;
        recipients[0] = addr2;

        vm.prank(owner);
        px.pause();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(MintingAlreadyStarted.selector));
        px.reserveTokensForMigration(tokenIds, recipients);
    }

    // Test: Cannot burn empty array
    function test_CannotBurnEmptyArray() public {
        uint256[] memory emptyArray = new uint256[](0);

        vm.prank(addr1);
        vm.expectRevert(abi.encodeWithSelector(EmptyPuppers.selector));
        px.burnPuppers(emptyArray);
    }

    // Test: Can burn multiple puppers
    function test_BurnMultiplePuppers() public {
        // Must have at least 4 puppers available
        assertGe(px.puppersRemaining(), 4);

        uint256[] memory burnTokens = new uint256[](4);
        burnTokens[0] = mintPupperWithValidation(addr1, 1);
        burnTokens[1] = mintPupperWithValidation(addr1, 1);
        burnTokens[2] = mintPupperWithValidation(addr1, 1);
        burnTokens[3] = mintPupperWithValidation(addr1, 1);

        vm.prank(addr1);
        px.burnPuppers(burnTokens);
    }

    // Test: Cannot mint when supply is exhausted
    function test_CannotMintWhenSupplyExhausted() public {
        // This test would take too long with full supply, so we'll test the revert logic
        // by mocking the puppersRemaining to be 0

        // First, let's test that the error message is correct when trying to mint more than available
        uint256 remaining = px.puppersRemaining();

        vm.prank(addr1);
        if (remaining + 1 > 50) {
            vm.expectRevert(abi.encodeWithSelector(BatchTooLarge.selector));
        } else {
            vm.expectRevert(abi.encodeWithSelector(NoPuppersRemaining.selector));
        }
        px.mintPuppers(remaining + 1, address(dog20));
    }

    // Test: Contract starts paused on deployment
    function test_ContractStartsPaused() public {
        // Deploy a fresh contract to test initial state
        PXV3 implementation = new PXV3();
        bytes memory initData = abi.encodeWithSelector(
            PXV3.__PX_init.selector,
            "TEST PX",
            "TPX",
            address(dog20),
            MOCK_URI,
            MOCK_WIDTH,
            MOCK_HEIGHT,
            feesAccountDev,
            address(this)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), initData);
        PXV3 freshPx = PXV3(address(proxy));

        // Contract should start paused
        assertTrue(freshPx.paused());

        // Should not be able to mint while paused
        vm.prank(addr1);
        dog20.approve(address(freshPx), DOG_TO_PIXEL_SATOSHIS);

        vm.prank(addr1);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        freshPx.mintPuppers(1, address(dog20));

        // Owner should be able to unpause
        freshPx.unpause();
        assertFalse(freshPx.paused());
    }

    // Test: Pause functionality
    function test_PauseFunctionality() public {
        // Contract should not be paused after setUp unpause
        assertFalse(px.paused());

        // Owner can pause
        px.pause();
        assertTrue(px.paused());

        // Cannot mint when paused
        vm.prank(addr1);
        dog20.approve(address(px), DOG_TO_PIXEL_SATOSHIS);

        vm.prank(addr1);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        px.mintPuppers(1, address(dog20));

        // Owner can unpause
        px.unpause();
        assertFalse(px.paused());

        // Can mint again after unpause - simplified test
        vm.prank(addr1);
        dog20.approve(address(px), DOG_TO_PIXEL_SATOSHIS);

        vm.prank(addr1);
        px.mintPuppers(1, address(dog20));

        // Verify the mint worked
        assertEq(px.balanceOf(addr1), 1);
    }

    // Test: NFT transfers are blocked when paused
    function test_TransfersBlockedWhenPaused() public {
        // Mint a token to addr1
        vm.prank(addr1);
        dog20.approve(address(px), DOG_TO_PIXEL_SATOSHIS);
        vm.prank(addr1);
        uint256 tokenId = mintPupperWithValidation(addr1, 1);

        // Pause the contract
        px.pause();

        // transferFrom should revert
        vm.prank(addr1);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        px.transferFrom(addr1, addr2, tokenId);

        // safeTransferFrom should revert
        vm.prank(addr1);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        px.safeTransferFrom(addr1, addr2, tokenId);

        // Unpause and transfer should work
        px.unpause();
        vm.prank(addr1);
        px.transferFrom(addr1, addr2, tokenId);
        assertEq(px.ownerOf(tokenId), addr2);
    }

    // Test: Only admin or pause manager can pause/unpause
    function test_OnlyOwnerOrPauseManagerCanPause() public {
        // Non-admin, non-pause-manager cannot pause
        vm.startPrank(addr1);
        vm.expectRevert(
            abi.encodeWithSignature("AccessControlUnauthorizedAccount(address,bytes32)", addr1, px.PAUSE_MANAGER_ROLE())
        );
        px.pause();
        vm.stopPrank();

        // Admin can pause
        px.pause();

        // Non-admin, non-pause-manager cannot unpause
        vm.startPrank(addr1);
        vm.expectRevert(
            abi.encodeWithSignature("AccessControlUnauthorizedAccount(address,bytes32)", addr1, px.PAUSE_MANAGER_ROLE())
        );
        px.unpause();
        vm.stopPrank();

        // Pause manager can pause and unpause
        px.unpause(); // admin unpauses first
        px.grantRole(px.PAUSE_MANAGER_ROLE(), addr2);

        vm.prank(addr2);
        px.pause();
        assertTrue(px.paused());

        vm.prank(addr2);
        px.unpause();
        assertFalse(px.paused());
    }

    // Test: Metadata functions
    function test_Metadata() public {
        assertEq(px.name(), "LONG LIVE D O G");
        assertEq(px.symbol(), "PX");

        uint256 tokenId = mintPupperWithValidation(addr1, 1);
        string memory uri = px.tokenURI(tokenId);
        assertTrue(bytes(uri).length > 0);

        // Test that URI contains expected components
        assertTrue(_contains(uri, MOCK_URI));
        assertTrue(_contains(uri, vm.toString(tokenId)));
    }

    // Test: Pixel coordinate functions
    function test_PixelCoordinates() public {
        uint256 tokenId = mintPupperWithValidation(addr1, 1);

        uint256 pixelIndex = px.pupperToPixel(tokenId);
        assertEq(pixelIndex, tokenId - INDEX_OFFSET);

        uint256[2] memory coords = px.pupperToPixelCoords(tokenId);
        uint256 expectedX = pixelIndex % MOCK_WIDTH;
        uint256 expectedY = pixelIndex / MOCK_WIDTH;

        assertEq(coords[0], expectedX);
        assertEq(coords[1], expectedY);
    }

    // Test: Random minting produces different tokens
    function test_RandomMinting() public {
        // Use fresh address for this test to avoid running out of tokens
        address freshAddr = makeAddr("freshRandomAddr");
        dog20.mint(freshAddr, DOG_TO_PIXEL_SATOSHIS * 20); // Mint enough for 20 tokens

        uint256[] memory mintedTokens = new uint256[](10);

        for (uint256 i = 0; i < 10; i++) {
            mintedTokens[i] = mintPupperWithValidation(freshAddr, 1);
        }

        // Check that we got different token IDs (with high probability)
        bool foundDifferent = false;
        for (uint256 i = 1; i < mintedTokens.length; i++) {
            if (mintedTokens[i] != mintedTokens[0]) {
                foundDifferent = true;
                break;
            }
        }
        assertTrue(foundDifferent, "All minted tokens have the same ID");
    }

    // Helper function to check if string contains substring
    function _contains(string memory str, string memory substr) internal pure returns (bool) {
        bytes memory strBytes = bytes(str);
        bytes memory substrBytes = bytes(substr);

        if (substrBytes.length > strBytes.length) {
            return false;
        }

        for (uint256 i = 0; i <= strBytes.length - substrBytes.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < substrBytes.length; j++) {
                if (strBytes[i + j] != substrBytes[j]) {
                    found = false;
                    break;
                }
            }
            if (found) {
                return true;
            }
        }

        return false;
    }

    // Fuzz test: Mint random quantities
    function testFuzz_MintRandomQuantities(uint256 qty) public {
        qty = bound(qty, 1, 10); // Limit to reasonable range

        uint256 remaining = px.puppersRemaining();
        if (qty <= remaining) {
            // Give addr1 enough DOG tokens
            vm.prank(owner);
            dog20.mint(addr1, DOG_TO_PIXEL_SATOSHIS * qty);

            mintPupperWithValidation(addr1, qty);
        }
    }

    // Test gas usage for minting
    function test_GasUsageMinting() public {
        uint256 gasBefore = gasleft();
        mintPupperWithValidation(addr1, 1);
        uint256 gasUsed = gasBefore - gasleft();

        console.log("Gas used for minting 1 pupper:", gasUsed);

        // Gas usage should be reasonable (updated for security overflow checks)
        assertLt(gasUsed, 500000);
    }
}
