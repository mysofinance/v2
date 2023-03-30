// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ILoanProposalFactory} from "./interfaces/ILoanProposalFactory.sol";
import {ILoanProposalImpl} from "./interfaces/ILoanProposalImpl.sol";
import {IEvents} from "./interfaces/IEvents.sol";
import {Constants} from "../Constants.sol";
import {Errors} from "../Errors.sol";
import {Ownable} from "../Ownable.sol";

contract LoanProposalFactory is Ownable, IEvents, ILoanProposalFactory {
    address public immutable loanProposalImpl;
    address[] public loanProposals;
    mapping(address => bool) public isLoanProposal;
    uint256 public arrangerFeeSplit;

    constructor(address _loanProposalImpl) {
        loanProposalImpl = _loanProposalImpl;
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

    function setArrangerFeeSplit(uint256 _newArrangerFeeSplit) external {
        senderCheckOwner();
        if (_newArrangerFeeSplit > Constants.MAX_ARRANGER_SPLIT) {
            revert Errors.InvalidFee();
        }
        arrangerFeeSplit = _newArrangerFeeSplit;
    }

    function owner()
        external
        view
        override(Ownable, ILoanProposalFactory)
        returns (address)
    {
        return _owner;
    }
}
