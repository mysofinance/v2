// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

interface IFundingPool {
    event Deposited(address user, uint256 amount);
    event Withdrawn(address user, uint256 amount);
    event Subscribed(
        address indexed user,
        address indexed loanProposalAddr,
        uint256 amount
    );
    event Unsubscribed(
        address indexed user,
        address indexed loanProposalAddr,
        uint256 amount
    );
    event LoanProposalExecuted(
        address indexed loanProposal,
        address indexed borrower,
        uint256 finalLoanAmount,
        uint256 arrangerFee,
        uint256 protocolFee
    );

    /**
     * @notice function allows users to deposit into funding pool
     * @param amount amount to deposit
     * @param transferFee this accounts for any transfer fee token may have (e.g. paxg token)
     */
    function deposit(uint256 amount, uint256 transferFee) external;

    /**
     * @notice function allows users to withdraw from funding pool
     * @param amount amount to withdraw
     */
    function withdraw(uint256 amount) external;

    /**
     * @notice function allows users from funding pool to subscribe as lenders to a proposal
     * @param loanProposal address of the proposal to which user wants to subscribe
     * @param amount amount of subscription
     */
    function subscribe(address loanProposal, uint256 amount) external;

    /**
     * @notice function allows subscribed lenders to unsubscribe from a proposal
     * @dev there is a cooldown period after subscribing to mitigate possible griefing attacks
     * of subscription followed by quick unsubscription
     * @param loanProposal address of the proposal to which user wants to unsubscribe
     * @param amount amount of subscription removed
     */
    function unsubscribe(address loanProposal, uint256 amount) external;

    /**
     * @notice function allows execution of a proposal
     * @param loanProposal address of the proposal executed
     */
    function executeLoanProposal(address loanProposal) external;

    /**
     * @notice function returns factory address for loan proposals
     */
    function loanProposalFactory() external view returns (address);

    /**
     * @notice function returns address of deposit token for pool
     */
    function depositToken() external view returns (address);

    /**
     * @notice function returns balance deposited into pool
     * note: balance is tracked only through using deposit function
     * direct transfers into pool are not credited
     */
    function balanceOf(address) external view returns (uint256);

    /**
     * @notice function tracks total subscription amount for a given proposal address
     */
    function totalSubscribed(address) external view returns (uint256);

    /**
     * @notice function tracks if subscription is deployed for a given proposal address
     */
    function totalSubscribedIsDeployed(address) external view returns (bool);

    /**
     * @notice function tracks subscription amounts for a given proposal address and subsciber address
     */
    function subscribedBalanceOf(
        address,
        address
    ) external view returns (uint256);
}
