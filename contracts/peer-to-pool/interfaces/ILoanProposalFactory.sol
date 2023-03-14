// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

interface ILoanProposalFactory {
    function createLoanProposal(
        address _fundingPool,
        address _collToken,
        uint256 _arrangerFee,
        uint256 _lenderGracePeriod
    ) external;

    function setArrangerFeeSplit(uint256 _newArrangerFeeSplit) external;

    function loanProposalImpl() external view returns (address);

    function loanProposals(uint256) external view returns (address);

    function isLoanProposal(address) external view returns (bool);

    function arrangerFeeSplit() external view returns (uint256);

    function owner() external view returns (address);
}
