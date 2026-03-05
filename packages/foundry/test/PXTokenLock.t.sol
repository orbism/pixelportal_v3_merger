// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {PXV3} from "../src/PXV3.sol";
import {MockDOG20} from "./mocks/MockDOG20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// Import custom errors
import {InvalidTokenAddress, TokenNotConfiguredForLocking, NoLockFoundForPixel} from "../src/PXV3.sol";

contract MockERC20 {
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

/**
 * @title PXTokenLockTest
 * @dev Tests for the configurable token lock system in PX contract
 */
contract PXTokenLockTest is Test {
    // Test constants
    uint256 constant CROP = 2;
    uint256 constant MOCK_WIDTH = (680 * CROP) / 100;
    uint256 constant MOCK_HEIGHT = (480 * CROP) / 100;
    uint256 constant MOCK_SUPPLY = MOCK_WIDTH * MOCK_HEIGHT;
    string constant MOCK_URI = "ipfs://dog-repo/";
    uint256 constant DOG_TO_PIXEL_SATOSHIS = 5523989899 * 10 ** 13;
    uint256 constant INDEX_OFFSET = 1000000;

    // Contract instances
    PXV3 public px;
    MockDOG20 public dog20;
    MockERC20 public token1;
    MockERC20 public token2;

    // Test accounts
    address public owner;
    address public addr1;
    address public addr2;
    address public feesAccountDev;

    // Test amounts
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

        // Deploy test tokens
        dog20 = new MockDOG20();
        dog20.initialize(mockAddresses, DOG_TO_PIXEL_SATOSHIS * MOCK_SUPPLY);

        token1 = new MockERC20("Token1", "T1", 1000000e18);
        token2 = new MockERC20("Token2", "T2", 1000000e18);

        // Deploy PX contract
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

        // Setup token lock amounts
        px.setTokenLockAmount(address(dog20), DOG_TO_PIXEL_SATOSHIS);
        px.setTokenLockAmount(address(token1), TOKEN1_LOCK_AMOUNT);
        px.setTokenLockAmount(address(token2), TOKEN2_LOCK_AMOUNT);

        // Give users some tokens
        require(token1.transfer(addr1, 100000e18), "Transfer failed");
        require(token1.transfer(addr2, 100000e18), "Transfer failed");
        require(token2.transfer(addr1, 100000e18), "Transfer failed");
        require(token2.transfer(addr2, 100000e18), "Transfer failed");
    }

    function testSetTokenLockAmount() public {
        address newToken = makeAddr("newToken");
        uint256 lockAmount = 1337e18;

        vm.expectEmit(true, false, false, true);
        emit PXV3.TokenLockAmountSet(newToken, lockAmount);

        px.setTokenLockAmount(newToken, lockAmount);

        assertEq(px.tokenLockAmounts(newToken), lockAmount);
    }

    function testSetTokenLockAmountOnlyAdmin() public {
        vm.prank(addr1);
        vm.expectRevert();
        px.setTokenLockAmount(address(token1), 1000e18);
    }

    function testSetTokenLockAmountZeroAddress() public {
        vm.expectRevert(abi.encodeWithSelector(InvalidTokenAddress.selector));
        px.setTokenLockAmount(address(0), 1000e18);
    }

    function testMintWithConfiguredToken() public {
        vm.startPrank(addr1);

        token1.approve(address(px), TOKEN1_LOCK_AMOUNT);

        uint256 balanceBefore = token1.balanceOf(addr1);
        uint256 contractBalanceBefore = token1.balanceOf(address(px));

        // Record events to get the actual pixel ID
        vm.recordLogs();
        px.mintPuppers(1, address(token1));

        // Check token transfer
        assertEq(token1.balanceOf(addr1), balanceBefore - TOKEN1_LOCK_AMOUNT);
        assertEq(token1.balanceOf(address(px)), contractBalanceBefore + TOKEN1_LOCK_AMOUNT);

        // Get the pixel ID from Transfer event
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 pixelId = 0;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("Transfer(address,address,uint256)")) {
                pixelId = uint256(logs[i].topics[3]);
                break;
            }
        }

        // Check pixel lock record
        (address lockToken, uint256 lockAmount) = px.pixelLocks(pixelId);
        assertEq(lockToken, address(token1));
        assertEq(lockAmount, TOKEN1_LOCK_AMOUNT);

        vm.stopPrank();
    }

    function testMintWithUnconfiguredToken() public {
        address unconfiguredToken = makeAddr("unconfigured");

        vm.prank(addr1);
        vm.expectRevert(abi.encodeWithSelector(TokenNotConfiguredForLocking.selector));
        px.mintPuppers(1, unconfiguredToken);
    }

    function testMintMultiplePixelsWithDifferentTokens() public {
        vm.startPrank(addr1);

        token1.approve(address(px), TOKEN1_LOCK_AMOUNT);
        token2.approve(address(px), TOKEN2_LOCK_AMOUNT);

        // Mint with token1
        vm.recordLogs();
        px.mintPuppers(1, address(token1));

        Vm.Log[] memory logs1 = vm.getRecordedLogs();
        uint256 pixel1 = 0;
        for (uint256 i = 0; i < logs1.length; i++) {
            if (logs1[i].topics[0] == keccak256("Transfer(address,address,uint256)")) {
                pixel1 = uint256(logs1[i].topics[3]);
                break;
            }
        }

        // Mint with token2
        vm.recordLogs();
        px.mintPuppers(1, address(token2));

        Vm.Log[] memory logs2 = vm.getRecordedLogs();
        uint256 pixel2 = 0;
        for (uint256 i = 0; i < logs2.length; i++) {
            if (logs2[i].topics[0] == keccak256("Transfer(address,address,uint256)")) {
                pixel2 = uint256(logs2[i].topics[3]);
                break;
            }
        }

        // Check locks
        (address lock1Token, uint256 lock1Amount) = px.pixelLocks(pixel1);
        (address lock2Token, uint256 lock2Amount) = px.pixelLocks(pixel2);

        assertEq(lock1Token, address(token1));
        assertEq(lock1Amount, TOKEN1_LOCK_AMOUNT);
        assertEq(lock2Token, address(token2));
        assertEq(lock2Amount, TOKEN2_LOCK_AMOUNT);

        vm.stopPrank();
    }

    function testCannotBurnPixelWithoutLock() public {
        // In the current system, all pixels minted through our functions have locks
        // But we can test the error by trying to burn a non-existent token

        vm.startPrank(addr1);
        uint256[] memory invalidPixels = new uint256[](1);
        invalidPixels[0] = INDEX_OFFSET + 9999; // Non-existent pixel

        vm.expectRevert(abi.encodeWithSelector(NoLockFoundForPixel.selector));
        px.burnPuppers(invalidPixels);

        vm.stopPrank();
    }

    function testLegacyFunctionsStillWork() public {
        vm.startPrank(addr1);

        // Approve token1 tokens (not DOG tokens since we're minting with token1)
        token1.approve(address(px), TOKEN1_LOCK_AMOUNT);

        // Record events to get the actual pixel ID
        vm.recordLogs();
        px.mintPuppers(1, address(token1));

        // Get the pixel ID from Transfer event
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 pixelId = 0;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("Transfer(address,address,uint256)")) {
                pixelId = uint256(logs[i].topics[3]);
                break;
            }
        }

        // Check that token1 was locked (not DOG token)
        (address lockToken, uint256 lockAmount) = px.pixelLocks(pixelId);
        assertEq(lockToken, address(token1));
        assertEq(lockAmount, TOKEN1_LOCK_AMOUNT);

        vm.stopPrank();
    }

    // Setting lock amount to 0 disables the token for new mints
    function testSetTokenLockAmountZeroDisablesToken() public {
        px.setTokenLockAmount(address(token1), 0);
        assertEq(px.tokenLockAmounts(address(token1)), 0);

        vm.prank(addr1);
        vm.expectRevert(abi.encodeWithSelector(TokenNotConfiguredForLocking.selector));
        px.mintPuppers(1, address(token1));
    }

    // Burn returns 100% of locked tokens to user (no dev fee in V3)
    function testBurnReturnsCorrectTokens() public {
        vm.startPrank(addr1);

        token1.approve(address(px), TOKEN1_LOCK_AMOUNT * 2);
        token2.approve(address(px), TOKEN2_LOCK_AMOUNT);

        uint256[] memory pixelIds = new uint256[](3);

        vm.recordLogs();
        px.mintPuppers(2, address(token1));
        Vm.Log[] memory logs1 = vm.getRecordedLogs();
        uint256 logIndex = 0;
        for (uint256 i = 0; i < logs1.length; i++) {
            if (logs1[i].topics[0] == keccak256("Transfer(address,address,uint256)")) {
                pixelIds[logIndex] = uint256(logs1[i].topics[3]);
                logIndex++;
            }
        }

        vm.recordLogs();
        px.mintPuppers(1, address(token2));
        Vm.Log[] memory logs2 = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs2.length; i++) {
            if (logs2[i].topics[0] == keccak256("Transfer(address,address,uint256)")) {
                pixelIds[2] = uint256(logs2[i].topics[3]);
                break;
            }
        }

        uint256 token1BalanceBefore = token1.balanceOf(addr1);
        uint256 token2BalanceBefore = token2.balanceOf(addr1);

        px.burnPuppers(pixelIds);

        // V3: 100% returned
        assertEq(token1.balanceOf(addr1), token1BalanceBefore + (TOKEN1_LOCK_AMOUNT * 2));
        assertEq(token2.balanceOf(addr1), token2BalanceBefore + TOKEN2_LOCK_AMOUNT);

        (address lockToken1,) = px.pixelLocks(pixelIds[0]);
        (address lockToken2,) = px.pixelLocks(pixelIds[1]);
        (address lockToken3,) = px.pixelLocks(pixelIds[2]);

        assertEq(lockToken1, address(0));
        assertEq(lockToken2, address(0));
        assertEq(lockToken3, address(0));

        vm.stopPrank();
    }

    function testBurnNoDevFee() public {
        vm.startPrank(addr1);

        token1.approve(address(px), TOKEN1_LOCK_AMOUNT);

        vm.recordLogs();
        px.mintPuppers(1, address(token1));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 pixelId = 0;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("Transfer(address,address,uint256)")) {
                pixelId = uint256(logs[i].topics[3]);
                break;
            }
        }

        uint256 devBalanceBefore = token1.balanceOf(feesAccountDev);
        uint256 userBalanceBefore = token1.balanceOf(addr1);

        uint256[] memory pixelsToBurn = new uint256[](1);
        pixelsToBurn[0] = pixelId;

        px.burnPuppers(pixelsToBurn);

        // V3: no dev fee, 0 to dev, 100% to user
        assertEq(token1.balanceOf(feesAccountDev), devBalanceBefore);
        assertEq(token1.balanceOf(addr1), userBalanceBefore + TOKEN1_LOCK_AMOUNT);

        vm.stopPrank();
    }

    function testLockAmountChangesOnlyAffectFutureMints() public {
        vm.startPrank(addr1);

        token1.approve(address(px), TOKEN1_LOCK_AMOUNT * 3);

        vm.recordLogs();
        px.mintPuppers(1, address(token1));

        Vm.Log[] memory logs1 = vm.getRecordedLogs();
        uint256 pixelId1 = 0;
        for (uint256 i = 0; i < logs1.length; i++) {
            if (logs1[i].topics[0] == keccak256("Transfer(address,address,uint256)")) {
                pixelId1 = uint256(logs1[i].topics[3]);
                break;
            }
        }

        (, uint256 originalLockAmount) = px.pixelLocks(pixelId1);

        vm.stopPrank();

        px.setTokenLockAmount(address(token1), TOKEN1_LOCK_AMOUNT * 2);

        vm.startPrank(addr1);

        vm.recordLogs();
        px.mintPuppers(1, address(token1));

        Vm.Log[] memory logs2 = vm.getRecordedLogs();
        uint256 pixelId2 = 0;
        for (uint256 i = 0; i < logs2.length; i++) {
            if (logs2[i].topics[0] == keccak256("Transfer(address,address,uint256)")) {
                pixelId2 = uint256(logs2[i].topics[3]);
                break;
            }
        }

        (, uint256 newLockAmount) = px.pixelLocks(pixelId2);

        assertEq(originalLockAmount, TOKEN1_LOCK_AMOUNT);
        assertEq(newLockAmount, TOKEN1_LOCK_AMOUNT * 2);

        // Burn the original pixel and verify 100% return at original lock amount
        uint256[] memory pixelsToBurn = new uint256[](1);
        pixelsToBurn[0] = pixelId1;

        uint256 balanceBefore = token1.balanceOf(addr1);
        px.burnPuppers(pixelsToBurn);

        assertEq(token1.balanceOf(addr1), balanceBefore + TOKEN1_LOCK_AMOUNT);

        vm.stopPrank();
    }

    function testBurnReturnsOriginalAmountsAfterConfigChanges() public {
        vm.startPrank(addr1);

        token1.approve(address(px), TOKEN1_LOCK_AMOUNT * 4);
        token2.approve(address(px), TOKEN2_LOCK_AMOUNT * 3);

        vm.recordLogs();
        px.mintPuppers(1, address(token1));
        Vm.Log[] memory logs1 = vm.getRecordedLogs();
        uint256 pixel1 = uint256(logs1[0].topics[3]);

        vm.recordLogs();
        px.mintPuppers(1, address(token2));
        Vm.Log[] memory logs2 = vm.getRecordedLogs();
        uint256 pixel2 = uint256(logs2[0].topics[3]);

        vm.stopPrank();

        px.setTokenLockAmount(address(token1), TOKEN1_LOCK_AMOUNT * 3);
        px.setTokenLockAmount(address(token2), TOKEN2_LOCK_AMOUNT * 2);

        vm.startPrank(addr1);

        vm.recordLogs();
        px.mintPuppers(1, address(token1));
        Vm.Log[] memory logs3 = vm.getRecordedLogs();
        uint256 pixel3 = uint256(logs3[0].topics[3]);

        vm.recordLogs();
        px.mintPuppers(1, address(token2));
        Vm.Log[] memory logs4 = vm.getRecordedLogs();
        uint256 pixel4 = uint256(logs4[0].topics[3]);

        (, uint256 lock1Amount) = px.pixelLocks(pixel1);
        (, uint256 lock2Amount) = px.pixelLocks(pixel2);
        (, uint256 lock3Amount) = px.pixelLocks(pixel3);
        (, uint256 lock4Amount) = px.pixelLocks(pixel4);

        assertEq(lock1Amount, TOKEN1_LOCK_AMOUNT);
        assertEq(lock2Amount, TOKEN2_LOCK_AMOUNT);
        assertEq(lock3Amount, TOKEN1_LOCK_AMOUNT * 3);
        assertEq(lock4Amount, TOKEN2_LOCK_AMOUNT * 2);

        uint256 token1Before = token1.balanceOf(addr1);
        uint256 token2Before = token2.balanceOf(addr1);

        uint256[] memory originalPixels = new uint256[](2);
        originalPixels[0] = pixel1;
        originalPixels[1] = pixel2;

        px.burnPuppers(originalPixels);

        // V3: 100% returned
        assertEq(token1.balanceOf(addr1), token1Before + TOKEN1_LOCK_AMOUNT);
        assertEq(token2.balanceOf(addr1), token2Before + TOKEN2_LOCK_AMOUNT);

        vm.stopPrank();
    }

    // Burn still works after a token is disabled (set to 0)
    function testBurnAfterTokenDisabled() public {
        vm.startPrank(addr1);

        token1.approve(address(px), TOKEN1_LOCK_AMOUNT);
        token2.approve(address(px), TOKEN2_LOCK_AMOUNT);

        vm.recordLogs();
        px.mintPuppers(1, address(token1));
        Vm.Log[] memory logs1 = vm.getRecordedLogs();
        uint256 pixel1 = uint256(logs1[0].topics[3]);

        vm.recordLogs();
        px.mintPuppers(1, address(token2));
        Vm.Log[] memory logs2 = vm.getRecordedLogs();
        uint256 pixel2 = uint256(logs2[0].topics[3]);

        vm.stopPrank();

        // Disable token1 by setting amount to 0
        px.setTokenLockAmount(address(token1), 0);

        // New mints with disabled token should fail
        vm.startPrank(addr1);
        token1.approve(address(px), TOKEN1_LOCK_AMOUNT);
        vm.expectRevert(abi.encodeWithSelector(TokenNotConfiguredForLocking.selector));
        px.mintPuppers(1, address(token1));

        // But burning previously minted pixels should still return 100%
        uint256 token1Before = token1.balanceOf(addr1);
        uint256 token2Before = token2.balanceOf(addr1);

        uint256[] memory pixelsToBurn = new uint256[](2);
        pixelsToBurn[0] = pixel1;
        pixelsToBurn[1] = pixel2;

        px.burnPuppers(pixelsToBurn);

        assertEq(token1.balanceOf(addr1), token1Before + TOKEN1_LOCK_AMOUNT);
        assertEq(token2.balanceOf(addr1), token2Before + TOKEN2_LOCK_AMOUNT);

        vm.stopPrank();
    }

    function testMultipleTokenChangesAndBurns() public {
        MockERC20 token3 = new MockERC20("Token3", "T3", 1000000e18);
        uint256 TOKEN3_LOCK_AMOUNT = 2000e18;

        require(token3.transfer(addr1, 100000e18), "Transfer failed");
        require(token3.transfer(addr2, 100000e18), "Transfer failed");

        px.setTokenLockAmount(address(token3), TOKEN3_LOCK_AMOUNT);

        vm.startPrank(addr1);

        token1.approve(address(px), TOKEN1_LOCK_AMOUNT * 5);
        token2.approve(address(px), TOKEN2_LOCK_AMOUNT * 5);
        token3.approve(address(px), TOKEN3_LOCK_AMOUNT * 5);

        uint256[] memory initialPixels = new uint256[](3);

        vm.recordLogs();
        px.mintPuppers(1, address(token1));
        initialPixels[0] = uint256(vm.getRecordedLogs()[0].topics[3]);

        vm.recordLogs();
        px.mintPuppers(1, address(token2));
        initialPixels[1] = uint256(vm.getRecordedLogs()[0].topics[3]);

        vm.recordLogs();
        px.mintPuppers(1, address(token3));
        initialPixels[2] = uint256(vm.getRecordedLogs()[0].topics[3]);

        vm.stopPrank();

        // Change lock amounts, disable token2
        px.setTokenLockAmount(address(token1), TOKEN1_LOCK_AMOUNT * 2);
        px.setTokenLockAmount(address(token2), 0); // Disable
        px.setTokenLockAmount(address(token3), TOKEN3_LOCK_AMOUNT / 2);

        vm.startPrank(addr1);

        uint256[] memory newPixels = new uint256[](2);

        vm.recordLogs();
        px.mintPuppers(1, address(token1));
        newPixels[0] = uint256(vm.getRecordedLogs()[0].topics[3]);

        vm.recordLogs();
        px.mintPuppers(1, address(token3));
        newPixels[1] = uint256(vm.getRecordedLogs()[0].topics[3]);

        // Disabled token should fail for new mints
        vm.expectRevert(abi.encodeWithSelector(TokenNotConfiguredForLocking.selector));
        px.mintPuppers(1, address(token2));

        uint256 token1Before = token1.balanceOf(addr1);
        uint256 token2Before = token2.balanceOf(addr1);
        uint256 token3Before = token3.balanceOf(addr1);

        uint256[] memory allPixels = new uint256[](5);
        allPixels[0] = initialPixels[0];
        allPixels[1] = initialPixels[1];
        allPixels[2] = initialPixels[2];
        allPixels[3] = newPixels[0];
        allPixels[4] = newPixels[1];

        px.burnPuppers(allPixels);

        // V3: 100% returned
        uint256 expectedToken1Return = TOKEN1_LOCK_AMOUNT + (TOKEN1_LOCK_AMOUNT * 2);
        uint256 expectedToken2Return = TOKEN2_LOCK_AMOUNT;
        uint256 expectedToken3Return = TOKEN3_LOCK_AMOUNT + (TOKEN3_LOCK_AMOUNT / 2);

        assertEq(token1.balanceOf(addr1), token1Before + expectedToken1Return);
        assertEq(token2.balanceOf(addr1), token2Before + expectedToken2Return);
        assertEq(token3.balanceOf(addr1), token3Before + expectedToken3Return);

        vm.stopPrank();
    }

    // Events for testing
    event TokenLockAmountSet(address indexed tokenAddress, uint256 amount);
    event TokenLocked(uint256 indexed pixelId, address indexed tokenAddress, uint256 amount);
    event TokenUnlocked(uint256 indexed pixelId, address indexed tokenAddress, uint256 amount);
}
