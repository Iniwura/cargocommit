// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SeldraOrder} from "./SeldraOrder.sol";

/// @title SeldraFactory
/// @notice Creates immutable Seldra purchase orders and keeps a registry so front ends can discover
///         orders without an indexer. The factory never holds funds. The buyer of every order is the
///         account that called `createOrder`, so nobody can create an order that names another wallet
///         as buyer.
contract SeldraFactory {
    uint256 public constant ORDER_SCHEMA_VERSION = 1;

    /// @dev Calldata input, grouped to keep the stack shallow.
    struct OrderParams {
        address supplier;
        address arbiter;
        uint256 orderAmount;
        uint16 depositBps;
        uint16 fallbackSupplierBps;
        bytes32 referenceHash;
        uint256 fundingDeadline;
        uint256 shipmentDeadline;
        uint256 buyerDecisionDeadline;
        uint256 disputeDeadline;
    }

    mapping(address order => bool created) public isOrder;
    address[] private _orders;
    mapping(address participant => address[] orders) private _ordersOf;

    event OrderCreated(
        address indexed order,
        address indexed buyer,
        address indexed supplier,
        address arbiter,
        uint256 orderAmount,
        uint16 depositBps,
        uint16 fallbackSupplierBps,
        bytes32 referenceHash,
        uint256 fundingDeadline,
        uint256 shipmentDeadline,
        uint256 buyerDecisionDeadline,
        uint256 disputeDeadline,
        bytes32 termsHash,
        uint256 createdAtBlock
    );

    error IndexOutOfBounds();

    /// @notice Deploys a new order with `msg.sender` as buyer. Invalid terms revert in the order constructor.
    function createOrder(OrderParams calldata p) external returns (address order) {
        SeldraOrder created = new SeldraOrder(
            SeldraOrder.Terms({
                buyer: msg.sender,
                supplier: p.supplier,
                arbiter: p.arbiter,
                orderAmount: p.orderAmount,
                depositBps: p.depositBps,
                fallbackSupplierBps: p.fallbackSupplierBps,
                referenceHash: p.referenceHash,
                fundingDeadline: p.fundingDeadline,
                shipmentDeadline: p.shipmentDeadline,
                buyerDecisionDeadline: p.buyerDecisionDeadline,
                disputeDeadline: p.disputeDeadline
            })
        );
        order = address(created);

        isOrder[order] = true;
        _orders.push(order);
        // The order constructor guarantees buyer, supplier and arbiter are pairwise distinct.
        _ordersOf[msg.sender].push(order);
        _ordersOf[p.supplier].push(order);
        _ordersOf[p.arbiter].push(order);

        emit OrderCreated(
            order,
            msg.sender,
            p.supplier,
            p.arbiter,
            p.orderAmount,
            p.depositBps,
            p.fallbackSupplierBps,
            p.referenceHash,
            p.fundingDeadline,
            p.shipmentDeadline,
            p.buyerDecisionDeadline,
            p.disputeDeadline,
            created.termsHash(),
            created.createdAtBlock()
        );
    }

    function orderCount() external view returns (uint256) {
        return _orders.length;
    }

    function orderAt(uint256 index) external view returns (address) {
        if (index >= _orders.length) revert IndexOutOfBounds();
        return _orders[index];
    }

    function ordersOfCount(address participant) external view returns (uint256) {
        return _ordersOf[participant].length;
    }

    function orderOfAt(address participant, uint256 index) external view returns (address) {
        if (index >= _ordersOf[participant].length) revert IndexOutOfBounds();
        return _ordersOf[participant][index];
    }
}
