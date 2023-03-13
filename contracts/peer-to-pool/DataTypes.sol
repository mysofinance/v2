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

    enum LoanStatus {
        IN_NEGOTIATION,
        BORROWER_ACCEPTED,
        READY_TO_EXECUTE,
        ROLLBACK,
        LOAN_DEPLOYED,
        DEFAULTED
    }
}
