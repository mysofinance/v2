// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {LoanProposalImpl} from "./LoanProposalImpl.sol";

contract LoanProposalFactory {
    address public loanProposalImpl;
    address[] public loanProposals;
    mapping(address => bool) public isLoanProposal;

    constructor(address _loanProposalImpl) {
        loanProposalImpl = _loanProposalImpl;
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
        LoanProposalImpl(newLoanProposal).initialize(
            msg.sender,
            _fundingPool,
            _collToken,
            _arrangerFee,
            _lenderGracePeriod
        );
    }
}
