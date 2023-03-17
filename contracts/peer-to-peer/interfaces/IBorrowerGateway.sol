// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypes} from "../DataTypes.sol";

interface IBorrowerGateway {
    /**
     * @notice function which allows a borrower to use an offChain quote to borrow
     * @param lenderVault address of the vault whose owner(s) signed the offChain quote
     * @param borrowInstructions data needed for borrow (see DataTypes comments)
     * @param offChainQuote quote data (see DataTypes comments)
     * @param quoteTuple quote data (see DataTypes comments)
     * @param proof array of bytes needed for merkle tree verification of quote
     */
    function borrowWithOffChainQuote(
        address lenderVault,
        DataTypes.BorrowTransferInstructions calldata borrowInstructions,
        DataTypes.OffChainQuote calldata offChainQuote,
        DataTypes.QuoteTuple calldata quoteTuple,
        bytes32[] memory proof
    ) external;

    /**
     * @notice function which allows a borrower to use an onChain quote to borrow
     * @param lenderVault address of the vault whose owner(s) enacted onChain quote
     * @param borrowInstructions data needed for borrow (see DataTypes comments)
     * @param onChainQuote quote data (see DataTypes comments)
     * @param quoteTupleIdx index of quote tuple array
     */
    function borrowWithOnChainQuote(
        address lenderVault,
        DataTypes.BorrowTransferInstructions calldata borrowInstructions,
        DataTypes.OnChainQuote calldata onChainQuote,
        uint256 quoteTupleIdx
    ) external;

    /**
     * @notice function which allows a borrower to repay a loan
     * @param loanRepayInstructions data needed for loan repay (see DataTypes comments)
     * @param vaultAddr address of the vault in which loan was taken out
     * @param callbackAddr address for callback (if any, e.g. 1-click repay)
     * @param callbackData data needed by the callback address
     */
    function repay(
        DataTypes.LoanRepayInstructions calldata loanRepayInstructions,
        address vaultAddr,
        address callbackAddr,
        bytes calldata callbackData
    ) external;

    /**
     * @notice function which allows owner to set new protocol fee
     * @dev protocolFee is in units of BASE constant (10**18) and annualized
     * @param _newFee new fee in BASE
     */
    function setNewProtocolFee(uint256 _newFee) external;

    /**
     * @notice function returns address registry
     */
    function addressRegistry() external view returns (address);

    /**
     * @notice function returns protocol fee
     */
    function protocolFee() external view returns (uint256);
}
