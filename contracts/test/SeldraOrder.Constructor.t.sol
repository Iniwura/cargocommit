// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SeldraTestBase} from "./SeldraOrder.Base.t.sol";
import {SeldraOrder} from "../SeldraOrder.sol";
import {SeldraFactory} from "../SeldraFactory.sol";

contract SeldraOrderConstructorTest is SeldraTestBase {
    function _create(SeldraFactory.OrderParams memory p) internal returns (address) {
        vm.prank(buyer);
        return factory.createOrder(p);
    }

    function _expectCreateRevert(SeldraFactory.OrderParams memory p, bytes4 sel) internal {
        vm.prank(buyer);
        vm.expectRevert(sel);
        factory.createOrder(p);
    }

    // ------------------------------------------------------------ addresses

    function test_Revert_ZeroSupplier() public {
        _expectCreateRevert(_params(address(0), arbiter), SeldraOrder.InvalidAddress.selector);
    }

    function test_Revert_ZeroArbiter() public {
        _expectCreateRevert(_params(supplier, address(0)), SeldraOrder.InvalidAddress.selector);
    }

    function test_Revert_ZeroBuyer_Direct() public {
        vm.expectRevert(SeldraOrder.InvalidAddress.selector);
        new SeldraOrder(_terms(address(0), _params(supplier, arbiter)));
    }

    function test_Revert_DuplicateAddresses() public {
        _expectCreateRevert(_params(buyer, arbiter), SeldraOrder.InvalidAddress.selector); // buyer==supplier
        _expectCreateRevert(_params(supplier, buyer), SeldraOrder.InvalidAddress.selector); // buyer==arbiter
        _expectCreateRevert(_params(supplier, supplier), SeldraOrder.InvalidAddress.selector); // supplier==arbiter
    }

    // ------------------------------------------------------------ amount

    function test_Revert_ZeroAmount() public {
        SeldraFactory.OrderParams memory p = _params(supplier, arbiter);
        p.orderAmount = 0;
        _expectCreateRevert(p, SeldraOrder.InvalidAmount.selector);
    }

    function test_Revert_AmountNotMultipleOf1e12() public {
        SeldraFactory.OrderParams memory p = _params(supplier, arbiter);
        p.orderAmount = 1e12 + 1;
        _expectCreateRevert(p, SeldraOrder.InvalidAmount.selector);
        p.orderAmount = 1e18 - 1;
        _expectCreateRevert(p, SeldraOrder.InvalidAmount.selector);
        p.orderAmount = 999_999_999_999;
        _expectCreateRevert(p, SeldraOrder.InvalidAmount.selector);
    }

    function test_Amount_MinimumUnitAccepted() public {
        SeldraFactory.OrderParams memory p = _params(supplier, arbiter);
        p.orderAmount = 1e12;
        SeldraOrder o = SeldraOrder(payable(_create(p)));
        assertEq(o.orderAmount(), 1e12);
        assertEq(o.depositAmount() + o.reserveAmount(), 1e12);
    }

    function testFuzz_AmountMultipleRule(uint256 amount) public {
        amount = bound(amount, 1, 1e30);
        SeldraFactory.OrderParams memory p = _params(supplier, arbiter);
        p.orderAmount = amount;
        if (amount % 1e12 != 0) {
            _expectCreateRevert(p, SeldraOrder.InvalidAmount.selector);
        } else {
            SeldraOrder o = SeldraOrder(payable(_create(p)));
            assertEq(o.depositAmount() + o.reserveAmount(), amount);
        }
    }

    function test_Revert_AmountOverflowingDepositMath() public {
        // multiple of 1e12 near uint256 max: rejected explicitly by the uint128 bound
        SeldraFactory.OrderParams memory p = _params(supplier, arbiter);
        p.orderAmount = (type(uint256).max / 1e12) * 1e12;
        vm.prank(buyer);
        vm.expectRevert(SeldraOrder.InvalidAmount.selector);
        factory.createOrder(p);
    }

    // ------------------------------------------------------------ bps

    function test_Revert_DepositBpsBounds() public {
        SeldraFactory.OrderParams memory p = _params(supplier, arbiter);
        p.depositBps = 0;
        _expectCreateRevert(p, SeldraOrder.InvalidBps.selector);
        p.depositBps = 10_000;
        _expectCreateRevert(p, SeldraOrder.InvalidBps.selector);
        p.depositBps = 10_001;
        _expectCreateRevert(p, SeldraOrder.InvalidBps.selector);
        p.depositBps = type(uint16).max;
        _expectCreateRevert(p, SeldraOrder.InvalidBps.selector);
    }

    function test_DepositBps_EdgesAccepted() public {
        SeldraFactory.OrderParams memory p = _params(supplier, arbiter);
        p.depositBps = 1;
        SeldraOrder o = SeldraOrder(payable(_create(p)));
        assertEq(o.depositAmount(), AMOUNT / 10_000);
        p.depositBps = 9_999;
        o = SeldraOrder(payable(_create(p)));
        assertEq(o.depositAmount(), (AMOUNT * 9_999) / 10_000);
        assertEq(o.reserveAmount(), AMOUNT - o.depositAmount());
        assertGt(o.reserveAmount(), 0);
    }

    function test_Revert_FallbackBpsAbove10000() public {
        SeldraFactory.OrderParams memory p = _params(supplier, arbiter);
        p.fallbackSupplierBps = 10_001;
        _expectCreateRevert(p, SeldraOrder.InvalidBps.selector);
        p.fallbackSupplierBps = type(uint16).max;
        _expectCreateRevert(p, SeldraOrder.InvalidBps.selector);
    }

    function test_FallbackBps_ZeroAndFullAccepted() public {
        SeldraFactory.OrderParams memory p = _params(supplier, arbiter);
        p.fallbackSupplierBps = 0;
        assertEq(SeldraOrder(payable(_create(p))).fallbackSupplierBps(), 0);
        p.fallbackSupplierBps = 10_000;
        assertEq(SeldraOrder(payable(_create(p))).fallbackSupplierBps(), 10_000);
    }

    // ------------------------------------------------------------ deadlines

    function test_Revert_FundingDeadlineNotInFuture() public {
        SeldraFactory.OrderParams memory p = _params(supplier, arbiter);
        p.fundingDeadline = block.timestamp; // == now -> invalid
        _expectCreateRevert(p, SeldraOrder.InvalidDeadlines.selector);
        p.fundingDeadline = block.timestamp - 1;
        _expectCreateRevert(p, SeldraOrder.InvalidDeadlines.selector);
        p.fundingDeadline = 0;
        _expectCreateRevert(p, SeldraOrder.InvalidDeadlines.selector);
    }

    function test_FundingDeadline_NowPlusOneAccepted() public {
        SeldraFactory.OrderParams memory p = _params(supplier, arbiter);
        p.fundingDeadline = block.timestamp + 1;
        assertEq(SeldraOrder(payable(_create(p))).fundingDeadline(), block.timestamp + 1);
    }

    function test_Revert_DeadlineOrdering() public {
        SeldraFactory.OrderParams memory p = _params(supplier, arbiter);
        // shipment <= funding
        p.shipmentDeadline = fundingDl;
        _expectCreateRevert(p, SeldraOrder.InvalidDeadlines.selector);
        p.shipmentDeadline = fundingDl - 1;
        _expectCreateRevert(p, SeldraOrder.InvalidDeadlines.selector);
        // decision <= shipment
        p = _params(supplier, arbiter);
        p.buyerDecisionDeadline = shipDl;
        _expectCreateRevert(p, SeldraOrder.InvalidDeadlines.selector);
        p.buyerDecisionDeadline = shipDl - 1;
        _expectCreateRevert(p, SeldraOrder.InvalidDeadlines.selector);
        // dispute <= decision
        p = _params(supplier, arbiter);
        p.disputeDeadline = decDl;
        _expectCreateRevert(p, SeldraOrder.InvalidDeadlines.selector);
        p.disputeDeadline = decDl - 1;
        _expectCreateRevert(p, SeldraOrder.InvalidDeadlines.selector);
    }

    function test_StrictlyIncreasingByOneSecondAccepted() public {
        SeldraFactory.OrderParams memory p = _params(supplier, arbiter);
        p.fundingDeadline = block.timestamp + 1;
        p.shipmentDeadline = block.timestamp + 2;
        p.buyerDecisionDeadline = block.timestamp + 3;
        p.disputeDeadline = block.timestamp + 4;
        SeldraOrder o = SeldraOrder(payable(_create(p)));
        assertEq(o.disputeDeadline(), block.timestamp + 4);
    }

    function test_Horizon_Exactly365DaysAccepted_Plus1Reverts() public {
        SeldraFactory.OrderParams memory p = _params(supplier, arbiter);
        p.disputeDeadline = block.timestamp + 365 days;
        SeldraOrder o = SeldraOrder(payable(_create(p)));
        assertEq(o.disputeDeadline(), block.timestamp + 365 days);
        p.disputeDeadline = block.timestamp + 365 days + 1;
        _expectCreateRevert(p, SeldraOrder.InvalidDeadlines.selector);
        assertEq(o.MAX_TERM(), 365 days);
    }

    function test_Revert_HugeDeadlines() public {
        SeldraFactory.OrderParams memory p = _params(supplier, arbiter);
        p.fundingDeadline = type(uint256).max - 2;
        p.shipmentDeadline = type(uint256).max - 1;
        p.buyerDecisionDeadline = type(uint256).max;
        p.disputeDeadline = type(uint256).max; // also violates ordering
        _expectCreateRevert(p, SeldraOrder.InvalidDeadlines.selector);
        p.disputeDeadline = type(uint256).max;
        p.buyerDecisionDeadline = type(uint256).max - 1;
        p.shipmentDeadline = type(uint256).max - 2;
        p.fundingDeadline = type(uint256).max - 3; // ordered but beyond horizon
        _expectCreateRevert(p, SeldraOrder.InvalidDeadlines.selector);
    }

    // ------------------------------------------------------------ immutability

    function test_Immutable_NoSettersExist() public {
        string[14] memory sigs = [
            "setBuyer(address)",
            "setSupplier(address)",
            "setArbiter(address)",
            "setOrderAmount(uint256)",
            "setDepositBps(uint16)",
            "setFundingDeadline(uint256)",
            "setShipmentDeadline(uint256)",
            "setBuyerDecisionDeadline(uint256)",
            "setDisputeDeadline(uint256)",
            "transferOwnership(address)",
            "owner()",
            "pause()",
            "upgradeTo(address)",
            "setReserveRemaining(uint256)"
        ];
        for (uint256 i = 0; i < sigs.length; i++) {
            for (uint256 who = 0; who < 3; who++) {
                address caller = who == 0 ? buyer : (who == 1 ? supplier : arbiter);
                vm.prank(caller);
                (bool ok, bytes memory r) = address(order).call(abi.encodeWithSignature(sigs[i], address(0xBEEF)));
                assertFalse(ok, sigs[i]);
                assertEq(bytes4(r), SeldraOrder.DirectTransferRejected.selector);
            }
        }
    }

    function test_Immutable_TermsStoredExactly() public view {
        SeldraOrder.Summary memory s = order.orderSummary();
        assertEq(s.buyer, buyer);
        assertEq(s.supplier, supplier);
        assertEq(s.arbiter, arbiter);
        assertEq(s.orderAmount, AMOUNT);
        assertEq(s.depositBps, DEP_BPS);
        assertEq(s.fallbackSupplierBps, FB_BPS);
        assertEq(s.referenceHash, REF);
        assertEq(s.fundingDeadline, fundingDl);
        assertEq(s.shipmentDeadline, shipDl);
        assertEq(s.buyerDecisionDeadline, decDl);
        assertEq(s.disputeDeadline, dispDl);
        assertEq(order.BPS(), 10_000);
        assertEq(order.NATIVE_PER_USDC_UNIT(), 1e12);
        assertEq(order.PAYOUT_GAS(), 100_000);
    }
}
