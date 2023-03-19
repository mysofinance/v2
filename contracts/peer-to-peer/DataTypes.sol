// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

library DataTypes {
    struct Loan {
        // address of borrower
        address borrower;
        // address of coll token
        address collToken;
        // address of loan token
        address loanToken;
        // timestamp after which any portion of loan unpaid defaults
        uint40 expiry;
        // timestamp before which borrower cannot repay
        uint40 earliestRepay;
        // initial collateral amount of loan
        uint128 initCollAmount;
        // loan amount given
        uint128 initLoanAmount;
        // full repay amount at start of loan
        uint128 initRepayAmount;
        // amount repaid up until current time
        // note: partial repayments are allowed
        uint128 amountRepaidSoFar;
        // flag tracking if collateral has been unlocked by vault
        bool collUnlocked;
        // address of the compartment housing the collateral
        address collTokenCompartmentAddr;
    }

    struct QuoteTuple {
        // loan amount per one unit of collateral if no oracle
        // LTV in terms of the constant BASE (10 ** 18) if using oracle
        uint256 loanPerCollUnitOrLtv;
        // interest rate percentage in BASE (can be negative!)
        int256 interestRatePctInBase;
        // fee percentage,in BASE, which will be paid in upfront in collateral
        uint256 upfrontFeePctInBase;
        // length of the loan
        uint256 tenor;
    }

    struct GeneralQuoteInfo {
        // address of borrower (if address(0), open to any borrowers)
        address borrower;
        // address of collateral token
        address collToken;
        // address of loan token
        address loanToken;
        // address of oracle (optional)
        address oracleAddr;
        // min loan amount prevent griefing attacks or
        // amounts lender feels isn't worth unlocking on default
        uint256 minLoan;
        // max loan amount if lender wants a cap
        uint256 maxLoan;
        // timestamp after which quote automatically invalidates
        uint256 validUntil;
        // time that loan cannot be exercised
        uint256 earliestRepayTenor;
        // address of compartment implementation (optional)
        address borrowerCompartmentImplementation;
        // will invalidate quote after one use
        // if false, will be a standing quote
        bool isSingleUse;
    }

    struct OnChainQuote {
        // general quote info
        GeneralQuoteInfo generalQuoteInfo;
        // array of quote parameters
        QuoteTuple[] quoteTuples;
        // provides more distinguishabilty of quotes
        bytes32 salt;
    }

    struct OffChainQuote {
        // general quote info
        GeneralQuoteInfo generalQuoteInfo;
        // root of the merkle tree
        bytes32 quoteTuplesRoot;
        // provides more distinguishabilty of quotes
        bytes32 salt;
        // nonce allows for mass lender invalidation
        uint256 nonce;
        // chain id to prevent replay attacks
        uint256 chainId;
        // arrays of necessary parameters for recovering signatures
        uint8[] v;
        bytes32[] r;
        bytes32[] s;
    }

    struct LoanRepayInstructions {
        // loan id being repaid
        uint256 targetLoanId;
        // repay amount after transfer fees
        uint128 targetRepayAmount;
        // expected transfer fees in loan token
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
