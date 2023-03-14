// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "@openzeppelin/contracts/proxy/Clones.sol";
import {ILoanProposalFactory} from "./interfaces/ILoanProposalFactory.sol";
import {ILoanProposalImpl} from "./interfaces/ILoanProposalImpl.sol";
import {Constants} from "../Constants.sol";
import {Errors} from "../Errors.sol";
import {Ownable} from "../Ownable.sol";

contract LoanProposalFactory is Ownable {
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
        uint256 _lenderGracePeriod
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
            _lenderGracePeriod
        );
    }

    function setArrangerFeeSplit(uint256 _newArrangerFeeSplit) external {
        senderCheckOwner();
        if (_newArrangerFeeSplit > Constants.MAX_ARRANGER_SPLIT) {
            revert Errors.InvalidFee();
        }
        arrangerFeeSplit = _newArrangerFeeSplit;
    }

    function owner() external view returns (address) {
        return _owner;
    }
}
