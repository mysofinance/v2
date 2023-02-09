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
        bool hasCollCompartment;
        address collTokenCompartmentAddr;
    }

    struct OnChainQuote {
        uint256 loanPerCollUnit;
        uint256 interestRatePctInBase;
        uint256 upfrontFeePctInBase;
        address collToken;
        address loanToken;
        uint40 tenor;
        uint40 timeUntilEarliestRepay;
        bool isNegativeInterestRate;
        address borrowerCompartmentImplementation;
    }

    struct OffChainQuote {
        address borrower;
        address collToken;
        address loanToken;
        uint256 collAmount;
        uint256 loanAmount;
        uint256 expiry;
        uint256 earliestRepay;
        uint256 repayAmount;
        uint256 validUntil;
        uint256 upfrontFee;
        address borrowerCompartmentImplementation;
        uint256 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct LoanRepayInfo {
        address collToken;
        address loanToken;
        uint256 loanId;
        uint256 repayAmount;
        uint256 loanTokenTransferFees;
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
