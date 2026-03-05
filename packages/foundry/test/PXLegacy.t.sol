// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title PX Legacy Tests
/// @dev Tests documenting PX V1-specific behavior that has changed in PXV3.
/// These tests were extracted from the main test suite so the PXV3 tests pass cleanly.
/// Run separately: forge test --match-path "test/PXLegacy.t.sol" -vvv
///
/// Categories of V1-specific behavior:
/// - Burns returned 99% to user + 1% dev fee (PXV3 returns 100%)
/// - setTokenLockAmount(addr, 0) was allowed to disable tokens (PXV3 rejects with NonPositiveQuantity)
/// - No startMinting() gate — reservations and minting could coexist
/// - getAvailableSupply() calculated differently relative to puppersRemaining()

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {PXV3} from "../src/PXV3.sol";
import {MockDOG20} from "./mocks/MockDOG20.sol";
import {TestUtils} from "./utils/TestUtils.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";
import {ERC721OwnerQueryForNonexistentToken} from "../src/ERC721CustomUpgradeable.sol";

import {
    NoPuppersRemaining,
    ArraysLengthMismatch,
    EmptyArrays,
    BatchTooLarge,
    InvalidRecipient,
    InvalidTokenID,
    TokenIDOutOfRange,
    TokenAlreadyExists,
    TokenAlreadyReserved,
    TokenNotConfiguredForLocking,
    TokenNotReserved,
    BurnNotConfirmed,
    NotReservedForYou
} from "../src/PXV3.sol";

// ============================================================================
// Mock ERC20 (copied from PXTokenLock.t.sol for legacy token lock tests)
// ============================================================================

contract MockERC20Legacy {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol, uint256 _totalSupply) {
        name = _name;
        symbol = _symbol;
        totalSupply = _totalSupply;
        balanceOf[msg.sender] = _totalSupply;
    }

    function transfer(address to, uint256 amount) public returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

// ============================================================================
// PXLegacyCoreTest — From PX.t.sol
// Reservation tests (PXV3 requires startMinting() gate) and fee tests (PXV3 has no dev fee)
// ============================================================================

contract PXLegacyCoreTest is Test {
    uint256 constant CROP = 2;
    uint256 constant MOCK_WIDTH = (680 * CROP) / 100;
    uint256 constant MOCK_HEIGHT = (480 * CROP) / 100;
    uint256 constant MOCK_SUPPLY = MOCK_WIDTH * MOCK_HEIGHT;
    string constant MOCK_URI = "ipfs://dog-repo/";
    uint256 constant DOG_TO_PIXEL_SATOSHIS = 5523989899 * 10 ** 13;
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

    function setUp() public {
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
        // NOTE: startMinting() intentionally NOT called — reservation tests need mintingStarted == false

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
                    address from = address(uint160(uint256(logs[i].topics[1])));
                    if (from == address(0)) {
                        tokenId = uint256(logs[i].topics[3]);
                        break;
                    }
                }
            }

            require(tokenId != 0, "Transfer event was not fired");

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

    // ===== Reservation tests (PXV3 requires mintingStarted == false) =====

    function test_PreMintForMigration() public {
        uint256[] memory tokenIds = new uint256[](2);
        address[] memory recipients = new address[](2);

        tokenIds[0] = INDEX_OFFSET + 5;
        tokenIds[1] = INDEX_OFFSET + 10;
        recipients[0] = addr1;
        recipients[1] = addr2;

        uint256 remainingBefore = px.puppersRemaining();

        vm.prank(owner);
        px.pause();

        vm.expectEmit(true, true, false, false);
        emit PXV3.TokenReserved(tokenIds[0], addr1);
        vm.expectEmit(true, true, false, false);
        emit PXV3.TokenReserved(tokenIds[1], addr2);

        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients);

        assertTrue(px.isReserved(tokenIds[0]));
        assertTrue(px.isReserved(tokenIds[1]));

        vm.expectRevert();
        px.ownerOf(tokenIds[0]);
        vm.expectRevert();
        px.ownerOf(tokenIds[1]);

        assertEq(px.puppersRemaining(), remainingBefore - 2);
        assertEq(px.totalReserved(), 2);
        assertEq(px.balanceOf(addr1), 0);
        assertEq(px.balanceOf(addr2), 0);
    }

    function test_OnlyOwnerCanPreMint() public {
        uint256[] memory tokenIds = new uint256[](1);
        address[] memory recipients = new address[](1);

        tokenIds[0] = INDEX_OFFSET + 1;
        recipients[0] = addr1;

        vm.prank(owner);
        px.pause();
        assertTrue(px.paused());

        vm.startPrank(addr1);
        vm.expectRevert(
            abi.encodeWithSignature("AccessControlUnauthorizedAccount(address,bytes32)", addr1, px.DEFAULT_ADMIN_ROLE())
        );
        px.reserveTokensForMigration(tokenIds, recipients);
        vm.stopPrank();
    }

    function test_MultipleAdmins() public {
        address secondAdmin = makeAddr("secondAdmin");

        assertTrue(px.hasRole(px.DEFAULT_ADMIN_ROLE(), address(this)));
        assertFalse(px.hasRole(px.DEFAULT_ADMIN_ROLE(), secondAdmin));

        px.grantRole(px.DEFAULT_ADMIN_ROLE(), secondAdmin);

        assertTrue(px.hasRole(px.DEFAULT_ADMIN_ROLE(), address(this)));
        assertTrue(px.hasRole(px.DEFAULT_ADMIN_ROLE(), secondAdmin));

        assertTrue(px.paused() == false);

        px.pause();
        assertTrue(px.paused());

        vm.prank(secondAdmin);
        px.unpause();
        assertFalse(px.paused());

        vm.prank(secondAdmin);
        px.pause();
        assertTrue(px.paused());

        px.unpause();
        assertFalse(px.paused());

        px.pause();
        assertTrue(px.paused());

        uint256[] memory tokenIds1 = new uint256[](1);
        address[] memory recipients1 = new address[](1);
        tokenIds1[0] = INDEX_OFFSET + 1;
        recipients1[0] = addr1;

        uint256[] memory tokenIds2 = new uint256[](1);
        address[] memory recipients2 = new address[](1);
        tokenIds2[0] = INDEX_OFFSET + 2;
        recipients2[0] = addr2;

        px.reserveTokensForMigration(tokenIds1, recipients1);
        assertTrue(px.isReserved(tokenIds1[0]));

        vm.prank(secondAdmin);
        px.reserveTokensForMigration(tokenIds2, recipients2);
        assertTrue(px.isReserved(tokenIds2[0]));

        address thirdAdmin = makeAddr("thirdAdmin");

        vm.prank(secondAdmin);
        px.grantRole(px.DEFAULT_ADMIN_ROLE(), thirdAdmin);
        assertTrue(px.hasRole(px.DEFAULT_ADMIN_ROLE(), thirdAdmin));

        px.revokeRole(px.DEFAULT_ADMIN_ROLE(), thirdAdmin);
        assertFalse(px.hasRole(px.DEFAULT_ADMIN_ROLE(), thirdAdmin));

        vm.prank(secondAdmin);
        px.revokeRole(px.DEFAULT_ADMIN_ROLE(), address(this));
        assertFalse(px.hasRole(px.DEFAULT_ADMIN_ROLE(), address(this)));

        assertTrue(px.hasRole(px.DEFAULT_ADMIN_ROLE(), secondAdmin));

        vm.prank(secondAdmin);
        px.unpause();
        assertFalse(px.paused());

        vm.expectRevert(
            abi.encodeWithSignature(
                "AccessControlUnauthorizedAccount(address,bytes32)", address(this), px.DEFAULT_ADMIN_ROLE()
            )
        );
        px.pause();

        vm.prank(secondAdmin);
        px.pause();
        assertTrue(px.paused());

        console.log("Multiple admin test completed successfully");
    }

    function test_PreMintArrayLengthMismatch() public {
        uint256[] memory tokenIds = new uint256[](2);
        address[] memory recipients = new address[](1);

        tokenIds[0] = INDEX_OFFSET + 1;
        tokenIds[1] = INDEX_OFFSET + 2;
        recipients[0] = addr1;

        vm.prank(owner);
        px.pause();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ArraysLengthMismatch.selector));
        px.reserveTokensForMigration(tokenIds, recipients);
    }

    function test_PreMintEmptyArrays() public {
        uint256[] memory tokenIds = new uint256[](0);
        address[] memory recipients = new address[](0);

        vm.prank(owner);
        px.pause();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(EmptyArrays.selector));
        px.reserveTokensForMigration(tokenIds, recipients);
    }

    function test_PreMintBatchTooLarge() public {
        uint256[] memory tokenIds = new uint256[](101);
        address[] memory recipients = new address[](101);

        for (uint256 i = 0; i < 101; i++) {
            tokenIds[i] = INDEX_OFFSET + i;
            recipients[i] = addr1;
        }

        vm.prank(owner);
        px.pause();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(BatchTooLarge.selector));
        px.reserveTokensForMigration(tokenIds, recipients);
    }

    function test_PreMintInvalidRecipient() public {
        uint256[] memory tokenIds = new uint256[](1);
        address[] memory recipients = new address[](1);

        tokenIds[0] = INDEX_OFFSET + 1;
        recipients[0] = address(0);

        vm.prank(owner);
        px.pause();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(InvalidRecipient.selector));
        px.reserveTokensForMigration(tokenIds, recipients);
    }

    function test_PreMintInvalidTokenIds() public {
        uint256[] memory tokenIds = new uint256[](1);
        address[] memory recipients = new address[](1);
        recipients[0] = addr1;

        vm.prank(owner);
        px.pause();

        tokenIds[0] = INDEX_OFFSET - 1;

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(InvalidTokenID.selector));
        px.reserveTokensForMigration(tokenIds, recipients);

        tokenIds[0] = INDEX_OFFSET + MOCK_SUPPLY + 1;

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(TokenIDOutOfRange.selector));
        px.reserveTokensForMigration(tokenIds, recipients);
    }

    function test_PreMintWorksWhilePaused() public {
        vm.prank(owner);
        px.pause();
        assertTrue(px.paused());

        uint256[] memory tokenIds = new uint256[](1);
        address[] memory recipients = new address[](1);

        tokenIds[0] = INDEX_OFFSET + 1;
        recipients[0] = addr1;

        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients);

        assertTrue(px.isReserved(tokenIds[0]));
        (address reservedFor,) = px.getReservation(tokenIds[0]);
        assertEq(reservedFor, addr1);
    }

    function test_PreMintLargeBatch() public {
        uint256 batchSize = 50;
        uint256[] memory tokenIds = new uint256[](batchSize);
        address[] memory recipients = new address[](batchSize);

        for (uint256 i = 0; i < batchSize; i++) {
            tokenIds[i] = INDEX_OFFSET + i + 1;
            recipients[i] = i % 2 == 0 ? addr1 : addr2;
        }

        uint256 remainingBefore = px.puppersRemaining();

        vm.prank(owner);
        px.pause();

        uint256 gasBefore = gasleft();
        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients);

        uint256 gasUsed = gasBefore - gasleft();
        console.log("Gas used for pre-minting", batchSize, "tokens:", gasUsed);
        console.log("Gas per token:", gasUsed / batchSize);

        assertEq(px.puppersRemaining(), remainingBefore - batchSize);
        assertEq(px.totalReserved(), batchSize);

        assertTrue(px.isReserved(tokenIds[0]));
        assertTrue(px.isReserved(tokenIds[1]));
        assertTrue(px.isReserved(tokenIds[batchSize - 1]));

        (address reservedFor0,) = px.getReservation(tokenIds[0]);
        (address reservedFor1,) = px.getReservation(tokenIds[1]);
        (address reservedForLast,) = px.getReservation(tokenIds[batchSize - 1]);

        assertEq(reservedFor0, addr1);
        assertEq(reservedFor1, addr2);
        assertEq(reservedForLast, addr2);

        assertLt(gasUsed, 8000000);
    }

    function test_PreMintSpecificTokenIds() public {
        uint256[] memory tokenIds = new uint256[](5);
        address[] memory recipients = new address[](5);

        tokenIds[0] = INDEX_OFFSET + 1;
        tokenIds[1] = INDEX_OFFSET + 10;
        tokenIds[2] = INDEX_OFFSET + (MOCK_SUPPLY / 2);
        tokenIds[3] = INDEX_OFFSET + (MOCK_SUPPLY - 2);
        tokenIds[4] = INDEX_OFFSET + (MOCK_SUPPLY - 1);

        for (uint256 i = 0; i < 5; i++) {
            recipients[i] = makeAddr(string(abi.encodePacked("recipient", vm.toString(i))));
        }

        vm.prank(owner);
        px.pause();

        vm.prank(owner);
        px.reserveTokensForMigration(tokenIds, recipients);

        for (uint256 i = 0; i < 5; i++) {
            assertTrue(px.isReserved(tokenIds[i]));
            (address reservedFor,) = px.getReservation(tokenIds[i]);
            assertEq(reservedFor, recipients[i]);
        }
    }

    function test_PreMintExceedsSupply() public {
        vm.prank(owner);
        px.pause();

        uint256 remaining = px.puppersRemaining();
        uint256 tokensToMint = remaining - 5;

        uint256 batchSize = 100;
        uint256 batches = tokensToMint / batchSize;

        for (uint256 batch = 0; batch < batches; batch++) {
            uint256[] memory batchTokenIds = new uint256[](batchSize);
            address[] memory batchRecipients = new address[](batchSize);

            for (uint256 i = 0; i < batchSize; i++) {
                batchTokenIds[i] = INDEX_OFFSET + (batch * batchSize) + i + 1;
                batchRecipients[i] = addr1;
            }

            vm.prank(owner);
            px.reserveTokensForMigration(batchTokenIds, batchRecipients);
        }

        uint256 remainder = tokensToMint % batchSize;
        if (remainder > 0) {
            uint256[] memory remainderTokenIds = new uint256[](remainder);
            address[] memory remainderRecipients = new address[](remainder);

            for (uint256 i = 0; i < remainder; i++) {
                remainderTokenIds[i] = INDEX_OFFSET + (batches * batchSize) + i + 1;
                remainderRecipients[i] = addr1;
            }

            vm.prank(owner);
            px.reserveTokensForMigration(remainderTokenIds, remainderRecipients);
        }

        uint256[] memory tokenIds = new uint256[](10);
        address[] memory recipients = new address[](10);

        for (uint256 i = 0; i < 10; i++) {
            tokenIds[i] = INDEX_OFFSET + remaining - 10 + i;
            recipients[i] = addr2;
        }

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(TokenAlreadyReserved.selector));
        px.reserveTokensForMigration(tokenIds, recipients);
    }
}

// ============================================================================
// PXLegacyTokenLockTest — From PXTokenLock.t.sol
// Fee assertions (PXV3 returns 100%), NonPositiveQuantity (PXV3 rejects amount=0),
// and reservation+claim test (requires mintingStarted == false)
// ============================================================================

contract PXLegacyTokenLockTest is Test {
    uint256 constant CROP = 2;
    uint256 constant MOCK_WIDTH = (680 * CROP) / 100;
    uint256 constant MOCK_HEIGHT = (480 * CROP) / 100;
    uint256 constant MOCK_SUPPLY = MOCK_WIDTH * MOCK_HEIGHT;
    string constant MOCK_URI = "ipfs://dog-repo/";
    uint256 constant DOG_TO_PIXEL_SATOSHIS = 5523989899 * 10 ** 13;
    uint256 constant INDEX_OFFSET = 1000000;

    PXV3 public px;
    MockDOG20 public dog20;
    MockERC20Legacy public token1;
    MockERC20Legacy public token2;

    address public owner;
    address public addr1;
    address public addr2;
    address public feesAccountDev;

    uint256 constant TOKEN1_LOCK_AMOUNT = 1000e18;
    uint256 constant TOKEN2_LOCK_AMOUNT = 500e18;

    function setUp() public {
        owner = address(this);
        addr1 = makeAddr("addr1");
        addr2 = makeAddr("addr2");
        feesAccountDev = makeAddr("feesAccountDev");

        address[] memory mockAddresses = new address[](3);
        mockAddresses[0] = owner;
        mockAddresses[1] = addr1;
        mockAddresses[2] = addr2;

        dog20 = new MockDOG20();
        dog20.initialize(mockAddresses, DOG_TO_PIXEL_SATOSHIS * MOCK_SUPPLY);

        token1 = new MockERC20Legacy("Token1", "T1", 1000000e18);
        token2 = new MockERC20Legacy("Token2", "T2", 1000000e18);

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
        // NOTE: startMinting() intentionally NOT called — testClaimReservedWithConfiguredToken needs it

        px.setTokenLockAmount(address(dog20), DOG_TO_PIXEL_SATOSHIS);
        px.setTokenLockAmount(address(token1), TOKEN1_LOCK_AMOUNT);
        px.setTokenLockAmount(address(token2), TOKEN2_LOCK_AMOUNT);

        require(token1.transfer(addr1, 100000e18), "Transfer failed");
        require(token1.transfer(addr2, 100000e18), "Transfer failed");
        require(token2.transfer(addr1, 100000e18), "Transfer failed");
        require(token2.transfer(addr2, 100000e18), "Transfer failed");
    }

    // Reservation test — requires mintingStarted == false
    function testClaimReservedWithConfiguredToken() public {
        uint256 tokenId = INDEX_OFFSET + 50;

        px.pause();
        uint256[] memory tokenIds = new uint256[](1);
        address[] memory recipients = new address[](1);
        tokenIds[0] = tokenId;
        recipients[0] = addr1;

        px.reserveTokensForMigration(tokenIds, recipients);

        bool[] memory burnFlags = new bool[](1);
        burnFlags[0] = true;
        px.setBurnFlags(tokenIds, burnFlags);

        px.unpause();

        vm.startPrank(addr1);
        token1.approve(address(px), TOKEN1_LOCK_AMOUNT);

        px.claimReservedToken(tokenId, address(token1));

        (address lockToken, uint256 lockAmount) = px.pixelLocks(tokenId);
        assertEq(lockToken, address(token1));
        assertEq(lockAmount, TOKEN1_LOCK_AMOUNT);

        vm.stopPrank();
    }

}

