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

    function borrowWithOnChainQuote(
        address lenderVault,
        DataTypes.BorrowTransferInstructions calldata borrowInstructions,
        DataTypes.OnChainQuote calldata onChainQuote,
        uint256 quoteTupleIdx
    ) external;

    function repay(
        DataTypes.LoanRepayInstructions calldata loanRepayInstructions,
        address vaultAddr,
        address callbackAddr,
        bytes calldata callbackData
    ) external;

    function setNewProtocolFee(uint256 _newFee) external;

    function addressRegistry() external view returns (address);

    function protocolFee() external view returns (uint256);
}
