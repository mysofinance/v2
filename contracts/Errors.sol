// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

library Errors {
    error UnregisteredVault();
    error InvalidSender();
    error InvalidFee();
    error InsufficientSendAmount();
    error Invalid();
    error InvalidLoanIndex();
    error InvalidOraclePair();
    error InvalidAddress();
    error InvalidArrayLength();
    error NeitherTokenIsGOHM();
    error NoLpTokens();
    error InvalidPool();
    error IncorrectGaugeForLpToken();
    error InvalidGaugeIndex();
    error AlreadyStaked();
    error InvalidWithdrawAmount();
    error InvalidBorrower();
    error OutsideValidRepayWindow();
    error InvalidRepayAmount();
    error UnregisteredGateway();
    error NonWhitelistedOracle();
    error LTVHigherThanMax();
    error InsufficientVaultFunds();
    error NegativeRepaymentAmount();
    error OverflowUint128();
}
