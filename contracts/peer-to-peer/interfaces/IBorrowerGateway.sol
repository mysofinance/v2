// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../DataTypesPeerToPeer.sol";

interface IBorrowerGateway {
    event Borrowed(
        address indexed vaultAddr,
        address indexed borrower,
        DataTypesPeerToPeer.Loan loan,
        uint256 upfrontFee,
        uint256 indexed loanId,
        address callbackAddr,
        bytes callbackData,
        bool isLoan
    );

    event Repaid(
        address indexed vaultAddr,
        uint256 indexed loanId,
        uint256 repayAmount
    );

    event ProtocolFeeSet(uint256 newFee);

    /**
     * @notice function which allows a borrower to use an offChain quote to borrow
     * @param lenderVault address of the vault whose owner(s) signed the offChain quote
     * @param borrowInstructions data needed for borrow (see DataTypesPeerToPeer comments)
     * @param offChainQuote quote data (see DataTypesPeerToPeer comments)
     * @param quoteTuple quote data (see DataTypesPeerToPeer comments)
     * @param proof array of bytes needed for merkle tree verification of quote
     */
    function borrowWithOffChainQuote(
        address lenderVault,
        DataTypesPeerToPeer.BorrowTransferInstructions
            calldata borrowInstructions,
        DataTypesPeerToPeer.OffChainQuote calldata offChainQuote,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple,
        bytes32[] memory proof
    ) external;

    /**
     * @notice function which allows a borrower to use an onChain quote to borrow
     * @param lenderVault address of the vault whose owner(s) enacted onChain quote
     * @param borrowInstructions data needed for borrow (see DataTypesPeerToPeer comments)
     * @param onChainQuote quote data (see DataTypesPeerToPeer comments)
     * @param quoteTupleIdx index of quote tuple array
     */
    function borrowWithOnChainQuote(
        address lenderVault,
        DataTypesPeerToPeer.BorrowTransferInstructions
            calldata borrowInstructions,
        DataTypesPeerToPeer.OnChainQuote calldata onChainQuote,
        uint256 quoteTupleIdx
    ) external;

    /**
     * @notice function which allows a borrower to repay a loan
     * @param loanRepayInstructions data needed for loan repay (see DataTypesPeerToPeer comments)
     * @param vaultAddr address of the vault in which loan was taken out
     */
    function repay(
        DataTypesPeerToPeer.LoanRepayInstructions
            calldata loanRepayInstructions,
        address vaultAddr
    ) external;

    /**
     * @notice function which allows owner to set new protocol fee
     * @dev protocolFee is in units of BASE constant (10**18) and annualized
     * @param _newFee new fee in BASE
     */
    function setProtocolFee(uint256 _newFee) external;

    /**
     * @notice function returns address registry
     * @return address of registry
     */
    function addressRegistry() external view returns (address);

    /**
     * @notice function returns protocol fee
     * @return protocol fee in BASE
     */
    function protocolFee() external view returns (uint256);
}
