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
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
}