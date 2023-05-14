// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IFundingPoolImpl} from "./interfaces/IFundingPoolImpl.sol";
import {ILoanProposalImpl} from "./interfaces/ILoanProposalImpl.sol";
import {IFactory} from "./interfaces/IFactory.sol";
import {Constants} from "../Constants.sol";
import {DataTypesPeerToPool} from "./DataTypesPeerToPool.sol";
import {Errors} from "../Errors.sol";

contract FundingPoolImpl is Initializable, IFundingPoolImpl {
    using SafeERC20 for IERC20Metadata;

    address public factory;
    address public depositToken;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public totalSubscriptions;
    mapping(address => mapping(address => uint256)) public subscriptionAmountOf;
    // note: earliest unsubscribe time is to prevent griefing accept loans through atomic flashborrow, deposit, subscribe, unsubscribe, and withdraw
    mapping(address => mapping(address => uint256))
        internal earliestUnsubscribe;

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _factory,
        address _depositToken
    ) external initializer {
        if (_factory == address(0) || _depositToken == address(0)) {
            revert Errors.InvalidAddress();
        }
        factory = _factory;
        depositToken = _depositToken;
    }

    function deposit(uint256 amount, uint256 transferFee) external {
        if (amount == 0) {
            revert Errors.InvalidSendAmount();
        }
        uint256 preBal = IERC20Metadata(depositToken).balanceOf(address(this));
        IERC20Metadata(depositToken).safeTransferFrom(
            msg.sender,
            address(this),
            amount + transferFee
        );
        uint256 postBal = IERC20Metadata(depositToken).balanceOf(address(this));
        if (postBal != preBal + amount) {
            revert Errors.InvalidSendAmount();
        }
        balanceOf[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        if (amount == 0 || amount > balanceOf[msg.sender]) {
            revert Errors.InvalidWithdrawAmount();
        }
        balanceOf[msg.sender] -= amount;
        IERC20Metadata(depositToken).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function subscribe(address loanProposal, uint256 amount) external {
        if (amount == 0) {
            revert Errors.InvalidAmount();
        }
        if (!IFactory(factory).isLoanProposal(loanProposal)) {
            revert Errors.UnregisteredLoanProposal();
        }
        if (!ILoanProposalImpl(loanProposal).canSubscribe()) {
            revert Errors.NotInSubscriptionPhase();
        }
        if (amount > balanceOf[msg.sender]) {
            revert Errors.InsufficientBalance();
        }
        DataTypesPeerToPool.LoanTerms memory loanTerms = ILoanProposalImpl(
            loanProposal
        ).loanTerms();
        if (
            amount + totalSubscriptions[loanProposal] >
            loanTerms.maxTotalSubscriptions
        ) {
            revert Errors.SubscriptionAmountTooHigh();
        }
        balanceOf[msg.sender] -= amount;
        totalSubscriptions[loanProposal] += amount;
        subscriptionAmountOf[loanProposal][msg.sender] += amount;
        earliestUnsubscribe[loanProposal][msg.sender] =
            block.timestamp +
            Constants.MIN_WAIT_UNTIL_EARLIEST_UNSUBSCRIBE;

        emit Subscribed(msg.sender, loanProposal, amount);
    }

    function unsubscribe(address loanProposal, uint256 amount) external {
        if (amount == 0) {
            revert Errors.InvalidAmount();
        }
        if (!IFactory(factory).isLoanProposal(loanProposal)) {
            revert Errors.UnregisteredLoanProposal();
        }
        if (!ILoanProposalImpl(loanProposal).canUnsubscribe()) {
            revert Errors.NotInUnsubscriptionPhase();
        }
        if (amount > subscriptionAmountOf[loanProposal][msg.sender]) {
            revert Errors.UnsubscriptionAmountTooLarge();
        }
        if (block.timestamp < earliestUnsubscribe[loanProposal][msg.sender]) {
            revert Errors.BeforeEarliestUnsubscribe();
        }
        balanceOf[msg.sender] += amount;
        totalSubscriptions[loanProposal] -= amount;
        subscriptionAmountOf[loanProposal][msg.sender] -= amount;
        earliestUnsubscribe[loanProposal][msg.sender] = 0;

        emit Unsubscribed(msg.sender, loanProposal, amount);
    }

    function executeLoanProposal(address loanProposal) external {
        if (!IFactory(factory).isLoanProposal(loanProposal)) {
            revert Errors.UnregisteredLoanProposal();
        }

        (
            uint256 arrangerFee,
            uint256 finalLoanAmount,
            ,
            ,
            ,
            ,

        ) = ILoanProposalImpl(loanProposal).dynamicData();
        DataTypesPeerToPool.LoanTerms memory loanTerms = ILoanProposalImpl(
            loanProposal
        ).loanTerms();
        ILoanProposalImpl(loanProposal).checkAndupdateStatus();
        IERC20Metadata(depositToken).safeTransfer(
            loanTerms.borrower,
            finalLoanAmount
        );
        (, , address arranger, , , ) = ILoanProposalImpl(loanProposal)
            .staticData();
        uint256 protocolFeeShare = (arrangerFee *
            IFactory(factory).arrangerFeeSplit()) / Constants.BASE;
        IERC20Metadata(depositToken).safeTransfer(
            arranger,
            arrangerFee - protocolFeeShare
        );
        IERC20Metadata(depositToken).safeTransfer(
            IFactory(factory).owner(),
            protocolFeeShare
        );

        emit LoanProposalExecuted(
            loanProposal,
            loanTerms.borrower,
            finalLoanAmount,
            arrangerFee - protocolFeeShare,
            protocolFeeShare
        );
    }
}