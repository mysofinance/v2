// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

library DataTypes {
    struct Repayment {
        uint128 loanTokenDue;
        uint128 collTokenDueIfConverted;
        uint40 dueTimestamp;
        uint40 conversionGracePeriod;
        uint40 repaymentGracePeriod;
        bool repaid;
    }

    struct LoanTerms {
        address borrower;
        uint128 minLoanAmount;
        uint128 maxLoanAmount;
        uint128 collPerLoanToken;
        Repayment[] repaymentSchedule;
    }

    struct StaticLoanProposalData {
        address fundingPool;
        address collToken;
        address arranger;
        uint256 lenderGracePeriod;
    }

    struct DynamicLoanProposalData {
        uint256 arrangerFee;
        uint256 finalLoanAmount;
        uint256 finalCollAmountReservedForDefault;
        uint256 finalCollAmountReservedForConversions;
        uint256 loanTermsLockedTime;
        uint256 currentRepaymentIdx;
        DataTypes.LoanStatus status;
    }

    enum LoanStatus {
        WITHOUT_LOAN_TERMS,
        IN_NEGOTIATION,
        BORROWER_ACCEPTED,
        READY_TO_EXECUTE,
        ROLLBACK,
        LOAN_DEPLOYED,
        DEFAULTED
    }
}
