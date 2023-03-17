// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

library Errors {
    error UnregisteredVault();
    error InvalidDelegatee();
    error InvalidSender();
    error InvalidFee();
    error InsufficientSendAmount();
    error InvalidOraclePair();
    error InvalidOracleAnswer();
    error InvalidOracleDecimals();
    error InvalidOracleVersion();
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
    error EmptyRepaymentSchedule();
    error FirstDueDateTooClose();
    error DueDatesTooClose();
    error GracePeriodsTooShort();
    error InvalidRepaidStatus();
    error UnsubscribeGracePeriodTooShort();
    error UnregisteredLoanProposal();
    error NotInSubscribtionPhase();
    error InsufficientBalance();
    error SubscriptionAmountTooHigh();
    error BeforeEarliestUnsubscribe();
    error TotalSubscribedTooLow();
    error InvalidActionForCurrentStatus();
    error TotalSubscribedNotTargetInRange();
    error InvalidRollBackRequest();
}
