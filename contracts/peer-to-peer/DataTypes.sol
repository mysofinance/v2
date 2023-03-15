// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

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

    struct QuoteTuple {
        uint256 loanPerCollUnitOrLtv;
        int256 interestRatePctInBase;
        uint256 upfrontFeePctInBase;
        uint256 tenor;
    }

    struct GeneralQuoteInfo {
        address borrower;
        address collToken;
        address loanToken;
        address oracleAddr;
        uint256 minLoan;
        uint256 maxLoan;
        uint256 validUntil;
        uint256 earliestRepayTenor;
        address borrowerCompartmentImplementation;
        bool isSingleUse;
    }

    struct OnChainQuote {
        GeneralQuoteInfo generalQuoteInfo;
        QuoteTuple[] quoteTuples;
        bytes32 salt;
    }

    struct OffChainQuote {
        GeneralQuoteInfo generalQuoteInfo;
        bytes32 quoteTuplesRoot;
        bytes32 salt;
        uint256 nonce;
        uint256 chainId;
        uint8[] v;
        bytes32[] r;
        bytes32[] s;
    }

    struct LoanRepayInstructions {
        uint256 targetLoanId;
        uint128 targetRepayAmount;
        uint128 expectedTransferFee;
    }

    struct BorrowTransferInstructions {
        uint256 collSendAmount;
        uint256 expectedTransferFee;
        uint256 deadline;
        uint256 minLoanAmount;
        address callbackAddr;
        bytes callbackData;
    }
}
