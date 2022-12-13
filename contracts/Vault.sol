pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LoanRequest} from "./Mempool.sol";

struct Loan { 
   address borrower;
   address collToken;
   address loanToken;
   uint256 expiry;
   uint256 pledgeAmount;
   uint256 loanAmount;
   uint256 repayAmount;
   uint256 amountRepaidSoFar;
   uint256 collUnlockedSoFar;
}

contract Vault {
    using SafeERC20 for IERC20Metadata;

    mapping(uint256 => Loan) public loans;
    mapping(address => uint256) public lockedAmounts;
    uint256 public loanId;
    address public owner;
    address public mempool;

    error Invalid();

    constructor(address _mempool) {
        owner = msg.sender;
        mempool = _mempool;
    }
    
    function setAllowance(address spender, address token, uint256 amount) external {
        if (msg.sender != owner) {
            revert Invalid();
        }
        IERC20Metadata(token).approve(spender, amount);
    }

    function executeLoanRequest(LoanRequest calldata loanRequest) external {
        if (msg.sender != mempool) {
            revert Invalid();
        }
        Loan memory loan;
        loan.borrower = loanRequest.borrower;
        loan.collToken = loanRequest.borrower;
        loan.loanToken = loanRequest.loanToken;
        loan.expiry = loanRequest.expiry;
        loan.pledgeAmount = loanRequest.pledgeAmount;
        loan.loanAmount = loanRequest.loanAmount;
        loan.repayAmount = loanRequest.repayAmount;
        loans[loanId] = loan;
        lockedAmounts[loanRequest.collToken] += loanRequest.pledgeAmount;
        loanId += 1;
    }

    function repay(uint256 _loanId, uint256 amount) external {
        Loan storage loan = loans[_loanId];
        if (msg.sender != loan.borrower) {
            revert Invalid();
        }
        if (block.timestamp >= loan.expiry) {
            revert Invalid();
        }
        if (amount > loan.repayAmount - loan.amountRepaidSoFar) {
            revert Invalid();
        }
        IERC20Metadata(loan.collToken).safeTransfer(loan.borrower, loan.pledgeAmount * amount / loan.repayAmount);
        IERC20Metadata(loan.loanToken).safeTransferFrom(loan.borrower, address(this), amount);
        loan.amountRepaidSoFar += amount;
        lockedAmounts[loan.collToken] -= loan.pledgeAmount * amount / loan.repayAmount;
    }

    function deposit(address token, uint256 amount) external {
        if (msg.sender != owner) {
            revert Invalid();
        }
        IERC20Metadata(token).safeTransferFrom(msg.sender, address(this), amount);
    }

    function withdraw(address token, uint256 amount) external {
        if (msg.sender != owner) {
            revert Invalid();
        }
        uint256 vaultBalance = IERC20Metadata(token).balanceOf(address(this));
        if (amount > vaultBalance - lockedAmounts[token]) {
            revert Invalid();
        }
        IERC20Metadata(token).safeTransfer(owner, amount);
    }

    function unlockCollateral(address token, uint256[] calldata loanIds) external {
        uint256 tmp;
        uint256 totalUnlockableColl;
        for (uint256 i = 0; i < loanIds.length; ) {
            Loan storage loan = loans[loanIds[i]];
            if (loan.collToken != token) {
                revert Invalid();
            }
            if (block.timestamp >= loan.expiry) {
                tmp = loan.pledgeAmount - loan.collUnlockedSoFar;
            } else {
                tmp = loan.pledgeAmount * loan.amountRepaidSoFar / loan.repayAmount - loan.collUnlockedSoFar;
            }
            loan.collUnlockedSoFar += tmp;
            totalUnlockableColl += tmp;
            unchecked { i++; }
        }
    lockedAmounts[token] -= totalUnlockableColl;
    }
}
