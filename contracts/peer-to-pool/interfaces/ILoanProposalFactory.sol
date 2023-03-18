// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

interface ILoanProposalFactory {
    /**
     * @notice Creates a new loan proposal
     * @param _fundingPool The address of the funding pool from which lenders are allowed to subscribe, and -if loan proposal is successful- from where loan amount is sourced
     * @param _collToken The address of collateral token to be provided by borrower
     * @param _arrangerFee The relative arranger fee (where 100% = BASE)
     * @param _lenderGracePeriod If a lender subscribes to a loan and it gets accepted by the borrower, then the lender can still unsubscribe for _lenderGracePeriod before otherwise being locked in and funding the given loan proposal
     */
    function createLoanProposal(
        address _fundingPool,
        address _collToken,
        uint256 _arrangerFee,
        uint256 _lenderGracePeriod
    ) external;

    /**
     * @notice Sets the arranger fee split between the arranger and the protocol
     * @dev Can only be called by the loan proposal factory owner
     * @param _newArrangerFeeSplit The given arranger fee split (e.g. 10% = BASE/10, meaning 10% of absolute arranger fee goes to protocol and rest to arranger); note that this amount must be smaller than Constants.MAX_ARRANGER_SPLIT (<50%)
     */
    function setArrangerFeeSplit(uint256 _newArrangerFeeSplit) external;

    /**
     * @notice Returns the address of the proposal implementation
     * @return The address of the proposal implementation
     */
    function loanProposalImpl() external view returns (address);

    /**
     * @notice Returns the address of a registered loan proposal
     * @param idx The index of the given loan proposal
     * @return The address of a registered loan proposal
     */
    function loanProposals(uint256 idx) external view returns (address);

    /**
     * @notice Returns flag whether given address is a registered loan proposal contract
     * @param addr The address to check if its a registered loan proposal
     * @return Flag indicating whether address is a registered loan proposal contract
     */
    function isLoanProposal(address addr) external view returns (bool);

    /**
     * @notice Returns the arranger fee split between the arranger and the protocol (e.g. 10% = BASE/10, meaning 10% of absolute arranger fee goes to protocol and rest to arranger)
     * @return The arranger fee split between the arranger and the protocol
     */
    function arrangerFeeSplit() external view returns (uint256);

    /**
     * @notice Returns the address of the owner of this contract
     * @return The address of the owner of this contract
     */
    function owner() external view returns (address);
}
