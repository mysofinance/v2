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
        // amount of collateral sent
        uint256 collSendAmount;
        // includes protocol fee and native token transfer fee
        uint256 expectedTransferFee;
        // deadline to prevent stale transactions
        uint256 deadline;
        // slippage protection if oracle price is too loose
        uint256 minLoanAmount;
        // e.g., for one-click leverage
        address callbackAddr;
        // any data needed by callback
        bytes callbackData;
    }
}
