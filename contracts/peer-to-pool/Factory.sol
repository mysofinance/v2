// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IFactory} from "./interfaces/IFactory.sol";
import {IFundingPoolImpl} from "./interfaces/IFundingPoolImpl.sol";
import {ILoanProposalImpl} from "./interfaces/ILoanProposalImpl.sol";
import {Constants} from "../Constants.sol";
import {Errors} from "../Errors.sol";
import {Ownable} from "../Ownable.sol";

contract Factory is Ownable, IFactory {
    uint256 public arrangerFeeSplit;
    address public immutable loanProposalImpl;
    address public immutable fundingPoolImpl;
    address[] public loanProposals;
    address[] public fundingPools;
    mapping(address => bool) public isLoanProposal;
    mapping(address => bool) public isFundingPool;
    mapping(address => bool) internal depositTokenHasFundingPool;

    constructor(address _loanProposalImpl, address _fundingPoolImpl) {
        if (_loanProposalImpl == address(0) || _fundingPoolImpl == address(0)) {
            revert Errors.InvalidAddress();
        }
        loanProposalImpl = _loanProposalImpl;
        fundingPoolImpl = _fundingPoolImpl;
        _owner = msg.sender;
    }

    function createLoanProposal(
        address _fundingPool,
        address _collToken,
        uint256 _arrangerFee,
        uint256 _unsubscribeGracePeriod,
        uint256 _conversionGracePeriod,
        uint256 _repaymentGracePeriod
    ) external {
        if (!isFundingPool[_fundingPool]) {
            revert Errors.InvalidAddress();
        }
        bytes32 salt = keccak256(
            abi.encodePacked(loanProposalImpl, msg.sender, loanProposals.length)
        );
        address newLoanProposal = Clones.cloneDeterministic(
            loanProposalImpl,
            salt
        );
        loanProposals.push(newLoanProposal);
        isLoanProposal[newLoanProposal] = true;
        ILoanProposalImpl(newLoanProposal).initialize(
            msg.sender,
            _fundingPool,
            _collToken,
            _arrangerFee,
            _unsubscribeGracePeriod,
            _conversionGracePeriod,
            _repaymentGracePeriod
        );

        emit LoanProposalCreated(
            newLoanProposal,
            _fundingPool,
            msg.sender,
            _collToken,
            _arrangerFee,
            _unsubscribeGracePeriod
        );
    }

    function createFundingPool(address _depositToken) external {
        if (depositTokenHasFundingPool[_depositToken]) {
            revert Errors.FundingPoolAlreadyExists();
        }
        bytes32 salt = keccak256(
            abi.encodePacked(_depositToken, fundingPools.length)
        );
        address newFundingPool = Clones.cloneDeterministic(
            fundingPoolImpl,
            salt
        );
        fundingPools.push(newFundingPool);
        isFundingPool[newFundingPool] = true;
        depositTokenHasFundingPool[_depositToken] = true;
        IFundingPoolImpl(newFundingPool).initialize(
            address(this),
            _depositToken
        );

        emit FundingPoolCreated(newFundingPool, _depositToken);
    }

    function setArrangerFeeSplit(uint256 _newArrangerFeeSplit) external {
        senderCheckOwner();
        uint256 oldArrangerFeeSplit = arrangerFeeSplit;
        if (
            _newArrangerFeeSplit > Constants.MAX_ARRANGER_SPLIT ||
            _newArrangerFeeSplit == oldArrangerFeeSplit
        ) {
            revert Errors.InvalidFee();
        }
        arrangerFeeSplit = _newArrangerFeeSplit;
        emit ArrangerFeeSplitUpdated(oldArrangerFeeSplit, _newArrangerFeeSplit);
    }

    function owner()
        external
        view
        override(Ownable, IFactory)
        returns (address)
    {
        return _owner;
    }
}
