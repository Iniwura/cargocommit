// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SeldraTestBase} from "./SeldraOrder.Base.t.sol";
import {SeldraOrder} from "../SeldraOrder.sol";
import {SeldraFactory} from "../SeldraFactory.sol";

contract SeldraFactoryTest is SeldraTestBase {
    // ---------------------------------------------------------------- createOrder / event

    function test_CreateOrder_DeploysWithCallerAsBuyerAndRegisters() public view {
        assertEq(order.buyer(), buyer);
        assertEq(order.supplier(), supplier);
        assertEq(order.arbiter(), arbiter);
        assertEq(order.orderAmount(), AMOUNT);
        assertEq(order.depositAmount(), DEPOSIT);
        assertEq(order.reserveAmount(), RESERVE);
        assertEq(uint8(order.status()), uint8(SeldraOrder.Status.CREATED));
        assertTrue(factory.isOrder(address(order)));
        assertEq(factory.orderCount(), 1);
        assertEq(factory.orderAt(0), address(order));
        assertEq(factory.ORDER_SCHEMA_VERSION(), 1);
        assertEq(address(factory).balance, 0);
    }

    function test_CreateOrder_EmitsOrderCreatedWithTermsHash() public {
        SeldraFactory.OrderParams memory p = _params(supplier, arbiter);
        address expected = vm.computeCreateAddress(address(factory), vm.getNonce(address(factory)));
        bytes32 expectedHash = keccak256(abi.encode(block.chainid, expected, _terms(buyer, p)));

        vm.expectEmit(true, true, true, true, address(factory));
        emit SeldraFactory.OrderCreated(
            expected,
            buyer,
            supplier,
            arbiter,
            AMOUNT,
            DEP_BPS,
            FB_BPS,
            REF,
            fundingDl,
            shipDl,
            decDl,
            dispDl,
            expectedHash,
            block.number
        );
        vm.prank(buyer);
        address got = factory.createOrder(p);
        assertEq(got, expected);
        assertEq(SeldraOrder(payable(got)).termsHash(), expectedHash);
        assertEq(SeldraOrder(payable(got)).createdAtBlock(), block.number);
    }

    function test_CreateOrder_ReturnsAddressMatchingRegistry() public {
        vm.prank(buyer);
        address o2 = factory.createOrder(_params(supplier, arbiter));
        assertEq(factory.orderAt(1), o2);
        assertEq(factory.orderCount(), 2);
        assertTrue(o2 != address(order));
    }

    function test_TermsHashDiffersBetweenOrdersWithSameTerms() public {
        SeldraOrder o2 = _mk(buyer, supplier, arbiter);
        assertTrue(o2.termsHash() != order.termsHash());
    }

    // ---------------------------------------------------------------- registry views

    function test_Registry_PerParticipantIndexes() public {
        SeldraOrder o2 = _mk(buyer, victim, arbiter);
        assertEq(factory.ordersOfCount(buyer), 2);
        assertEq(factory.ordersOfCount(supplier), 1);
        assertEq(factory.ordersOfCount(arbiter), 2);
        assertEq(factory.ordersOfCount(victim), 1);
        assertEq(factory.ordersOfCount(stranger), 0);
        assertEq(factory.orderOfAt(buyer, 0), address(order));
        assertEq(factory.orderOfAt(buyer, 1), address(o2));
        assertEq(factory.orderOfAt(supplier, 0), address(order));
        assertEq(factory.orderOfAt(victim, 0), address(o2));
        assertEq(factory.orderOfAt(arbiter, 1), address(o2));
    }

    function test_Registry_OutOfBoundsReverts() public {
        vm.expectRevert(SeldraFactory.IndexOutOfBounds.selector);
        factory.orderAt(1);
        vm.expectRevert(SeldraFactory.IndexOutOfBounds.selector);
        factory.orderOfAt(buyer, 1);
        vm.expectRevert(SeldraFactory.IndexOutOfBounds.selector);
        factory.orderOfAt(stranger, 0);
    }

    function test_Registry_IsOrderFalseForUnregisteredOrder() public {
        SeldraOrder rogue = new SeldraOrder(_terms(buyer, _params(supplier, arbiter)));
        assertFalse(factory.isOrder(address(rogue)));
        assertFalse(factory.isOrder(address(0)));
        assertFalse(factory.isOrder(address(factory)));
        assertEq(factory.orderCount(), 1);
    }

    function test_FailedCreationLeavesRegistryUntouched() public {
        SeldraFactory.OrderParams memory p = _params(supplier, arbiter);
        p.orderAmount = 0;
        vm.prank(buyer);
        vm.expectRevert(SeldraOrder.InvalidAmount.selector);
        factory.createOrder(p);
        assertEq(factory.orderCount(), 1);
        assertEq(factory.ordersOfCount(buyer), 1);
    }

    function test_Factory_RejectsDirectValueAndUnknownCalls() public {
        (bool ok,) = address(factory).call{value: 0}("");
        assertFalse(ok);
        vm.deal(address(this), 1 ether);
        (ok,) = address(factory).call{value: 1 ether}("");
        assertFalse(ok);
        (ok,) = address(factory).call(abi.encodeWithSignature("withdraw()"));
        assertFalse(ok);
        assertEq(address(factory).balance, 0);
    }

    // ---------------------------------------------------------------- buyer is always msg.sender

    function testFuzz_BuyerIsAlwaysCaller(address caller) public {
        vm.assume(caller != supplier && caller != arbiter && caller != address(0));
        SeldraOrder o = _mk(caller, supplier, arbiter);
        assertEq(o.buyer(), caller);
        assertEq(factory.orderOfAt(caller, factory.ordersOfCount(caller) - 1), address(o));
    }

    function test_ThirdParty_CannotCreateOrderNamingVictimAsBuyer() public {
        // Attacker creates an order that names the victim as supplier and arbiter => impossible (pairwise
        // distinct enforced), and there is no param to set the buyer to the victim.
        address attacker = makeAddr("attacker");
        SeldraOrder o = _mk(attacker, victim, arbiter);
        assertEq(o.buyer(), attacker);
        assertTrue(o.buyer() != victim);
        // The victim can never become buyer of this order: fund() reverts for the victim.
        _accept(o);
        vm.deal(victim, AMOUNT);
        vm.prank(victim);
        vm.expectRevert(SeldraOrder.NotBuyer.selector);
        o.fund{value: AMOUNT}();
    }

    function test_CreateOrder_CallerCannotBeSupplierOrArbiter() public {
        vm.startPrank(buyer);
        vm.expectRevert(SeldraOrder.InvalidAddress.selector);
        factory.createOrder(_params(buyer, arbiter));
        vm.expectRevert(SeldraOrder.InvalidAddress.selector);
        factory.createOrder(_params(supplier, buyer));
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- spam orders naming victim

    function test_SpamOrders_ListedForVictimButCannotMoveVictimFunds() public {
        address attacker = makeAddr("attacker");
        vm.deal(victim, 50e18);
        for (uint256 i = 0; i < 5; i++) {
            _mk(attacker, victim, arbiter); // victim as supplier
            _mk(attacker, supplier, victim); // victim as arbiter
        }
        assertEq(factory.ordersOfCount(victim), 10);
        assertEq(victim.balance, 50e18);

        // Victim-as-arbiter order: attacker funds & disputes; arbiter (victim) holds no funds-control beyond reserve.
        SeldraOrder o = SeldraOrder(payable(factory.orderOfAt(victim, 1)));
        assertEq(o.arbiter(), victim);
        _toDisputed(o);
        // victim cannot pay out more than the reserve and cannot withdraw anything
        vm.startPrank(victim);
        vm.expectRevert(abi.encodeWithSelector(SeldraOrder.InvalidPayout.selector, RESERVE + 1, RESERVE));
        o.resolveDispute(RESERVE + 1);
        vm.expectRevert(SeldraOrder.NothingToWithdraw.selector);
        o.withdraw();
        vm.stopPrank();
        // after resolution victim (arbiter) has received nothing and the deposit stays with the named supplier
        vm.prank(victim);
        o.resolveDispute(RESERVE);
        assertEq(victim.balance, 50e18);
        assertEq(address(o).balance, 0);
    }

    function test_SpamOrders_NeverTouchVictimEvenWhenVictimIgnoresThem() public {
        address attacker = makeAddr("attacker");
        SeldraOrder o = _mk(attacker, victim, arbiter);
        vm.deal(victim, 7e18);
        // order lists the victim, but without the victim's own transactions nothing is ever taken
        _accept(o); // (pranked as supplier==victim; victim spends no value)
        assertEq(victim.balance, 7e18);
        vm.prank(attacker);
        o.cancelBeforeFunding();
        assertEq(victim.balance, 7e18);
        assertEq(factory.orderOfAt(victim, 0), address(o));
    }
}
