// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

library DataTypes {
    struct Repayment {
        // The loan token amount due for given period; initially, expressed in relative terms (100%=BASE), once finalized in absolute terms (in loan token)
        uint128 loanTokenDue;
        // The coll token amount that can be converted for given period; initially, expressed in relative terms w.r.t. loanTokenDue (100%=BASE), once finalized in absolute terms (in loan token)
        uint128 collTokenDueIfConverted;
        // Timestamp when repayment is due
        uint40 dueTimestamp;
        // Grace period during which lenders can convert, i.e., between [dueTimeStamp, dueTimeStamp+conversionGracePeriod]
        uint40 conversionGracePeriod;
        // Grace period during which the borrower can repay, i.e., between [dueTimeStamp+conversionGracePeriod, dueTimeStamp+conversionGracePeriod+repaymentGracePeriod]
        uint40 repaymentGracePeriod;
        // Flag whether given period is considered repaid
        bool repaid;
    }

    struct LoanTerms {
        // Borrower who can accept given loan proposal
        address borrower;
        // Min loan amount (in loan token) that the borrower intends to borrow
        uint128 minLoanAmount;
        // Max loan amount (in loan token) that the borrower intends to borrow
        uint128 maxLoanAmount;
        // The number of collateral tokens the borrower pledges per loan token borrowed as collateral for default case
        uint128 collPerLoanToken;
        // Array of scheduled repayments
        Repayment[] repaymentSchedule;
    }

    struct StaticLoanProposalData {
        // Funding pool address that is associated with given loan proposal and from which loan liquidity can be sourced
        address fundingPool;
        // Address of collateral token to be used for given loan proposal
        address collToken;
        // Address of arranger who can manage the loan proposal contract
        address arranger;
        // Lender grace period (in seconds), i.e., after acceptance by borrower lenders can unsubscribe and remove liquidity for this duration before being locked-in
        uint256 lenderGracePeriod;
    }

    struct DynamicLoanProposalData {
        // Arranger fee charged on final loan amount, initially in relative terms (100%=BASE), and after finalization in absolute terms (in loan token)
        uint256 arrangerFee;
        // Final loan amount; initially this is zero and gets set once loan proposal got accepted and finalized
        uint256 finalLoanAmount;
        // Final collateral amount reserved for defaults; initially this is zero and gets set once loan proposal got accepted and finalized
        uint256 finalCollAmountReservedForDefault;
        // Final collateral amount reserved for conversions; initially this is zero and gets set once loan proposal got accepted and finalized
        uint256 finalCollAmountReservedForConversions;
        // Timestamp when the loan terms get accepted by borrower and after which they cannot be changed anymore
        uint256 loanTermsLockedTime;
        // Current repayment index (see repayment schedule array)
        uint256 currentRepaymentIdx;
        // Status of current loan proposal
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
