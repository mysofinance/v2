// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

library DataTypes {
    struct Loan {
        address borrower;
        address collToken;
        address loanToken;
        uint40 expiry;
        uint40 earliestRepay;
        uint128 initCollAmount;
        uint128 initLoanAmount;
        uint128 initRepayAmount;
        uint128 amountRepaidSoFar;
        bool collUnlocked;
        address collTokenCompartmentAddr;
    }

    struct QuoteTuples {
        uint256[] loanPerCollUnitOrLtv;
        uint256[] interestRatePctInBase;
        uint256[] upfrontFeePctInBase;
        uint256[] tenor;
        uint256 earliestRepayTenor;
        bool isNegativeInterestRate;
    }

    struct Quote {
        address borrower;
        address collToken;
        address loanToken;
        QuoteTuples quoteTuples;
        address oracleAddr;
        uint256 minLoan;
        uint256 maxLoan;
        uint256 validUntil;
        address borrowerCompartmentImplementation;
        bool isSingleUse;
        bytes32 salt;
    }

    struct OffChainQuote {
        Quote quote;
        uint256 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct LoanRepayInfo {
        address collToken;
        address loanToken;
        uint256 loanId;
        uint128 repayAmount;
        uint256 repaySendAmount;
    }

    struct LoanRequest {
        address borrower;
        address collToken;
        address loanToken;
        uint256 sendAmount;
        uint256 loanAmount;
        uint256 expiry;
        uint256 earliestRepay;
        uint256 repayAmount;
        uint256 validUntil;
        uint256 upfrontFee;
        bool useCollCompartment;
    }

    enum WhiteListType {
        TOKEN,
        STRATEGY,
        COMPARTMENT,
        CALLBACK,
        STAKINGPOOL,
        FACTORY
    }
}
