// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {CargoCommitFactory} from "../src/CargoCommitFactory.sol";
import {CargoCommitOrder} from "../src/CargoCommitOrder.sol";

contract CargoCommitFactoryTest is Test {
    CargoCommitFactory internal factory;
    address internal buyer = address(0xB0B);
    address internal supplier = address(0x5A1);
    address internal arbiter = address(0xA81);
    uint256 internal constant ORDER = 1e18;
    uint16 internal constant DEPOSIT_BPS = 3000;
    uint16 internal constant FALLBACK_BPS = 5000;

    function setUp() public {
        factory = new CargoCommitFactory();
    }

    function testCreatesDiscoverableImmutableOrder() public {
        uint256 fundingDeadline = block.timestamp + 1 days;
        uint256 shipmentDeadline = fundingDeadline + 1 days;
        uint256 buyerDecisionDeadline = shipmentDeadline + 1 days;
        uint256 disputeDeadline = buyerDecisionDeadline + 1 days;

        CargoCommitOrder order = _create(fundingDeadline, shipmentDeadline, buyerDecisionDeadline, disputeDeadline);

        assertGt(address(order).code.length, 0);
        assertEq(order.buyer(), buyer);
        assertEq(order.supplier(), supplier);
        assertEq(order.arbiter(), arbiter);
        assertEq(order.orderAmount(), ORDER);
        assertEq(order.depositAmount(), 0.3e18);
        assertEq(order.reserveAmount(), 0.7e18);
        assertEq(order.depositBps(), DEPOSIT_BPS);
        assertEq(order.fallbackSupplierBps(), FALLBACK_BPS);
        assertEq(order.fundingDeadline(), fundingDeadline);
        assertEq(order.shipmentDeadline(), shipmentDeadline);
        assertEq(order.buyerDecisionDeadline(), buyerDecisionDeadline);
        assertEq(order.disputeDeadline(), disputeDeadline);
        assertTrue(order.termsHash() != bytes32(0));
    }

    function testFactoryEventCarriesCanonicalOrderAddressAndTerms() public {
        uint256 fundingDeadline = block.timestamp + 1 days;
        uint256 shipmentDeadline = fundingDeadline + 1 days;
        uint256 buyerDecisionDeadline = shipmentDeadline + 1 days;
        uint256 disputeDeadline = buyerDecisionDeadline + 1 days;

        vm.recordLogs();
        CargoCommitOrder order = _create(fundingDeadline, shipmentDeadline, buyerDecisionDeadline, disputeDeadline);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 signature = keccak256(
            "OrderCreated(address,address,address,address,uint256,uint16,uint16,uint256,uint256,uint256,uint256,bytes32)"
        );
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics.length == 4 && logs[i].topics[0] == signature) {
                assertEq(address(uint160(uint256(logs[i].topics[1]))), address(order));
                assertEq(address(uint160(uint256(logs[i].topics[2]))), buyer);
                assertEq(address(uint160(uint256(logs[i].topics[3]))), supplier);
                bytes memory data = logs[i].data;
                address emittedArbiter;
                bytes32 emittedTermsHash;
                assembly {
                    emittedArbiter := mload(add(data, 0x20))
                    emittedTermsHash := mload(add(data, 0x120))
                }
                assertEq(emittedArbiter, arbiter);
                assertEq(emittedTermsHash, order.termsHash());
                found = true;
            }
        }
        assertTrue(found);
    }

    function testFactoryCreatedOrderRunsFullHappyPath() public {
        uint256 fundingDeadline = block.timestamp + 1 days;
        uint256 shipmentDeadline = fundingDeadline + 1 days;
        uint256 buyerDecisionDeadline = shipmentDeadline + 1 days;
        uint256 disputeDeadline = buyerDecisionDeadline + 1 days;
        CargoCommitOrder order = _create(fundingDeadline, shipmentDeadline, buyerDecisionDeadline, disputeDeadline);
        vm.deal(buyer, ORDER);
        vm.deal(supplier, 0);

        vm.prank(supplier);
        order.acceptOrder();
        vm.prank(buyer);
        order.fund{value: ORDER}();
        assertEq(address(order).balance, 0.7e18);
        assertEq(supplier.balance, 0.3e18);

        vm.prank(supplier);
        order.submitShipment(keccak256("bill-of-lading"));
        vm.prank(buyer);
        order.approveShipment();

        assertEq(uint8(order.status()), uint8(CargoCommitOrder.Status.SETTLED));
        assertEq(order.reserveRemaining(), 0);
        assertEq(supplier.balance, 1e18);
        assertEq(address(order).balance, 0);
    }

    function testFactoryDoesNotCustodyFunds() public view {
        assertEq(address(factory).balance, 0);
    }

    function testFactoryPropagatesInvalidOrderTerms() public {
        vm.expectRevert(CargoCommitOrder.InvalidAddress.selector);
        factory.createOrder(
            address(0),
            supplier,
            arbiter,
            ORDER,
            DEPOSIT_BPS,
            FALLBACK_BPS,
            block.timestamp + 1 days,
            block.timestamp + 2 days,
            block.timestamp + 3 days,
            block.timestamp + 4 days
        );
    }

    function _create(
        uint256 fundingDeadline,
        uint256 shipmentDeadline,
        uint256 buyerDecisionDeadline,
        uint256 disputeDeadline
    ) internal returns (CargoCommitOrder) {
        return CargoCommitOrder(
            payable(factory.createOrder(
                    buyer,
                    supplier,
                    arbiter,
                    ORDER,
                    DEPOSIT_BPS,
                    FALLBACK_BPS,
                    fundingDeadline,
                    shipmentDeadline,
                    buyerDecisionDeadline,
                    disputeDeadline
                ))
        );
    }
}
