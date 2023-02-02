pragma solidity 0.8.17;

library DataTypes {
    struct Loan {
        address borrower;
        address loanToken;
        uint40 expiry;
        uint40 earliestRepay;
        uint128 initCollAmount;
        uint128 initLoanAmount;
        uint128 initRepayAmount;
        uint128 amountRepaidSoFar;
        bool collUnlocked;
    }

    struct LoanQuote {
        address borrower;
        address collToken;
        address loanToken;
        uint256 pledgeAmount;
        uint256 loanAmount;
        uint256 expiry;
        uint256 earliestRepay;
        uint256 repayAmount;
        uint256 validUntil;
        uint256 upfrontFee;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct StandingLoanOffer {
        uint256 loanPerCollUnit;
        uint256 interestRate;
        uint256 upfrontFee;
        address collToken;
        address loanToken;
        uint40 tenor;
        uint40 timeUntilEarliestRepay;
        bool isNegativeRate;
    }

    struct LoanRepayInfo {
        address collToken;
        address loanToken;
        uint256 loanId;
        uint256 repayAmount;
        uint256 loanTokenTransferFees;
    }
}
