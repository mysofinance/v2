// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.19;

interface IBorrowerGateway {
    event Borrow(
        address indexed vaultAddr,
        address indexed borrower,
        address collToken,
        address loanToken,
        uint40 expiry,
        uint40 earliestRepay,
        uint128 initCollAmount,
        uint128 initLoanAmount,
        uint128 initRepayAmount,
        uint128 amountRepaidSoFar,
        bool collUnlocked,
        address collTokenCompartmentAddr,
        uint256 loanId
    );

    event Repay(
        address indexed vaultAddr,
        uint256 indexed loanId,
        uint256 repayAmount
    );
}
