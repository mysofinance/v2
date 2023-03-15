// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

library Errors {
    error UnregisteredVault();
    error InvalidSender();
    error InvalidFee();
    error InsufficientSendAmount();
    error InvalidOraclePair();
    error InvalidAddress();
    error InvalidArrayLength();
    error NeitherTokenIsGOHM();
    error NoLpTokens();
    error IncorrectGaugeForLpToken();
    error InvalidGaugeIndex();
    error AlreadyStaked();
    error InvalidWithdrawAmount();
    error InvalidBorrower();
    error OutsideValidRepayWindow();
    error InvalidRepayAmount();
    error UnregisteredGateway();
    error NonWhitelistedOracle();
    error NonWhitelistedCompartment();
    error NonWhitelistedCallback();
    error LTVHigherThanMax();
    error InsufficientVaultFunds();
    error NegativeRepaymentAmount();
    error OverflowUint128();
    error InconsistentUnlockTokenAddresses();
    error ExpiresBeforeRepayAllowed();
    error MustHaveAtLeastOneSigner();
    error AlreadySigner();
    error InvalidArrayIndex();
    error InvalidSignerRemoveInfo();
    error InvalidSendAmount();
    error TooSmallLoanAmount();
    error DeadlinePassed();
    error WithdrawEntered();
}
