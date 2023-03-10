// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LoanProposalImpl} from "./LoanProposalImpl.sol";
import {LoanProposalFactory} from "./LoanProposalFactory.sol";
import {DataTypes} from "./DataTypes.sol";

contract FundingPool {
    using SafeERC20 for IERC20Metadata;

    address public loanProposalFactory;
    address public depositToken;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public totalSubscribed;
    mapping(address => bool) public totalSubscribedIsDeployed;
    mapping(address => mapping(address => uint256)) public subscribedBalanceOf;

    constructor(address _loanProposalFactory, address _depositToken) {
        loanProposalFactory = _loanProposalFactory;
        depositToken = _depositToken;
    }

    function deposit(uint256 amount, uint256 transferFee) external {
        uint256 preBal = IERC20Metadata(depositToken).balanceOf(address(this));
        IERC20Metadata(depositToken).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );
        uint256 postBal = IERC20Metadata(depositToken).balanceOf(address(this));
        if ((postBal - preBal) != amount - transferFee) {
            revert();
        }
        balanceOf[msg.sender] += postBal - preBal;
    }

    function withdraw(uint256 amount) external {
        uint256 userBal = IERC20Metadata(depositToken).balanceOf(msg.sender);
        if (amount > userBal) {
            revert();
        }
        balanceOf[msg.sender] -= amount;
        IERC20Metadata(depositToken).safeTransfer(msg.sender, amount);
    }

    function subscribe(address loanProposal, uint256 amount) external {
        if (
            !LoanProposalFactory(loanProposalFactory).isLoanProposal(
                loanProposal
            )
        ) {
            revert();
        }
        if (!LoanProposalImpl(loanProposal).inSubscriptionPhase()) {
            revert();
        }
        if (amount > balanceOf[msg.sender]) {
            revert();
        }
        DataTypes.LoanTerms memory loanTerms = LoanProposalImpl(loanProposal)
            .loanTerms();
        if (amount + totalSubscribed[loanProposal] > loanTerms.maxLoanAmount) {
            revert();
        }
        balanceOf[msg.sender] -= amount;
        totalSubscribed[loanProposal] += amount;
        subscribedBalanceOf[loanProposal][msg.sender] += amount;
    }

    function unsubscribe(address loanProposal, uint256 amount) external {
        if (
            !LoanProposalFactory(loanProposalFactory).isLoanProposal(
                loanProposal
            )
        ) {
            revert();
        }
        if (!LoanProposalImpl(loanProposal).inUnsubscriptionPhase()) {
            revert();
        }
        if (amount > balanceOf[msg.sender]) {
            revert();
        }
        if (amount > subscribedBalanceOf[loanProposal][msg.sender]) {
            revert();
        }
        balanceOf[msg.sender] += amount;
        totalSubscribed[loanProposal] -= amount;
        subscribedBalanceOf[loanProposal][msg.sender] -= amount;
    }

    function executeLoanProposal(address loanProposal) external {
        if (
            !LoanProposalFactory(loanProposalFactory).isLoanProposal(
                loanProposal
            )
        ) {
            revert();
        }
        if (
            LoanProposalImpl(loanProposal).status() !=
            DataTypes.LoanStatus.READY_TO_EXECUTE
        ) {
            revert();
        }
        DataTypes.LoanTerms memory loanTerms = LoanProposalImpl(loanProposal)
            .loanTerms();
        uint256 finalLoanAmount = LoanProposalImpl(loanProposal)
            .finalLoanAmount();
        uint256 finalCollAmount = LoanProposalImpl(loanProposal)
            .finalCollAmount();
        totalSubscribedIsDeployed[loanProposal] = true;
        LoanProposalImpl(loanProposal).updateStatusToDeployed();
        IERC20Metadata(LoanProposalImpl(loanProposal).loanToken()).safeTransfer(
            loanTerms.borrower,
            finalLoanAmount
        );
        IERC20Metadata(LoanProposalImpl(loanProposal).collToken())
            .safeTransferFrom(
                loanTerms.borrower,
                loanProposal,
                finalCollAmount
            );
        IERC20Metadata(LoanProposalImpl(loanProposal).loanToken()).safeTransfer(
            LoanProposalImpl(loanProposal).arranger(),
            LoanProposalImpl(loanProposal).arrangerFee()
        );
    }
}
