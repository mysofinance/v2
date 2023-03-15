// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Constants} from "../Constants.sol";
import {IFundingPool} from "./interfaces/IFundingPool.sol";
import {ILoanProposalImpl} from "./interfaces/ILoanProposalImpl.sol";
import {ILoanProposalFactory} from "./interfaces/ILoanProposalFactory.sol";
import {DataTypes} from "./DataTypes.sol";

contract FundingPool is IFundingPool {
    using SafeERC20 for IERC20Metadata;

    address public immutable loanProposalFactory;
    address public immutable depositToken;
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
            !ILoanProposalFactory(loanProposalFactory).isLoanProposal(
                loanProposal
            )
        ) {
            revert();
        }
        if (!ILoanProposalImpl(loanProposal).inSubscriptionPhase()) {
            revert();
        }
        if (amount > balanceOf[msg.sender]) {
            revert();
        }
        DataTypes.LoanTerms memory loanTerms = ILoanProposalImpl(loanProposal)
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
            !ILoanProposalFactory(loanProposalFactory).isLoanProposal(
                loanProposal
            )
        ) {
            revert();
        }
        if (!ILoanProposalImpl(loanProposal).inUnsubscriptionPhase()) {
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
            !ILoanProposalFactory(loanProposalFactory).isLoanProposal(
                loanProposal
            )
        ) {
            revert();
        }
        if (
            ILoanProposalImpl(loanProposal).status() !=
            DataTypes.LoanStatus.READY_TO_EXECUTE
        ) {
            revert();
        }
        DataTypes.LoanTerms memory loanTerms = ILoanProposalImpl(loanProposal)
            .loanTerms();
        uint256 finalLoanAmount = ILoanProposalImpl(loanProposal)
            .finalLoanAmount();
        uint256 finalCollAmount = ILoanProposalImpl(loanProposal)
            .finalCollAmount();
        totalSubscribedIsDeployed[loanProposal] = true;
        ILoanProposalImpl(loanProposal).updateStatusToDeployed();
        IERC20Metadata(depositToken).safeTransfer(
            loanTerms.borrower,
            finalLoanAmount
        );
        IERC20Metadata(ILoanProposalImpl(loanProposal).collToken())
            .safeTransferFrom(
                loanTerms.borrower,
                loanProposal,
                finalCollAmount
            );
        uint256 arrangerFee = ILoanProposalImpl(loanProposal).arrangerFee();
        uint256 protocolFeeShare = (arrangerFee *
            ILoanProposalFactory(loanProposalFactory).arrangerFeeSplit()) /
            Constants.BASE;
        IERC20Metadata(depositToken).safeTransfer(
            ILoanProposalImpl(loanProposal).arranger(),
            arrangerFee - protocolFeeShare
        );
        IERC20Metadata(depositToken).safeTransfer(
            ILoanProposalFactory(loanProposalFactory).owner(),
            protocolFeeShare
        );
    }
}
