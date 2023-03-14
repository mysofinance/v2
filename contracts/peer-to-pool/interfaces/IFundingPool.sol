// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

interface IFundingPool {
    function deposit(uint256 amount, uint256 transferFee) external;

    function withdraw(uint256 amount) external;

    function subscribe(address loanProposal, uint256 amount) external;

    function unsubscribe(address loanProposal, uint256 amount) external;

    function executeLoanProposal(address loanProposal) external;

    function loanProposalFactory() external view returns (address);

    function depositToken() external view returns (address);

    function balanceOf(address) external view returns (uint256);

    function totalSubscribed(address) external view returns (uint256);

    function totalSubscribedIsDeployed(address) external view returns (bool);

    function subscribedBalanceOf(
        address,
        address
    ) external view returns (uint256);
}
