// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import {DataTypesPeerToPeer} from "../DataTypesPeerToPeer.sol";

interface IQuoteHandler {
    event OnChainQuoteAdded(
        address lenderVault,
        DataTypesPeerToPeer.OnChainQuote onChainQuote,
        bytes32 onChainQuoteHash
    );

    event OnChainQuoteDeleted(address lenderVault, bytes32 onChainQuoteHash);

    event OnChainQuoteInvalidated(
        address lenderVault,
        bytes32 onChainQuoteHash
    );
    event OffChainQuoteInvalidated(
        address lenderVault,
        bytes32 offChainQuoteHash
    );

    /**
     * @notice function adds on chain quote
     * @dev function can only be called by vault owner
     * @param lenderVault address of the vault adding quote
     * @param onChainQuote data for the onChain quote (See notes in DataTypesPeerToPeer.sol)
     */
    function addOnChainQuote(
        address lenderVault,
        DataTypesPeerToPeer.OnChainQuote calldata onChainQuote
    ) external;

    /**
     * @notice function updates on chain quote
     * @dev function can only be called by vault owner
     * @param lenderVault address of the vault updating quote
     * @param oldOnChainQuote data for the old onChain quote (See notes in DataTypesPeerToPeer.sol)
     * @param newOnChainQuote data for the new onChain quote (See notes in DataTypesPeerToPeer.sol)
     */
    function updateOnChainQuote(
        address lenderVault,
        DataTypesPeerToPeer.OnChainQuote calldata oldOnChainQuote,
        DataTypesPeerToPeer.OnChainQuote calldata newOnChainQuote
    ) external;

    /**
     * @notice function deletes on chain quote
     * @dev function can only be called by vault owner
     * @param lenderVault address of the vault deleting
     * @param onChainQuote data for the onChain quote marked for deletion (See notes in DataTypesPeerToPeer.sol)
     */
    function deleteOnChainQuote(
        address lenderVault,
        DataTypesPeerToPeer.OnChainQuote calldata onChainQuote
    ) external;

    /**
     * @notice function increments the nonce for a vault
     * @dev function can only be called by vault owner
     * incrementing the nonce can bulk invalidate any
     * off chain quotes with that nonce in one txn
     * @param lenderVault address of the vault
     */
    function incrementOffChainQuoteNonce(address lenderVault) external;

    /**
     * @notice function invalidates off chain quote
     * @dev function can only be called by vault owner
     * this function invalidates one specific quote
     * @param lenderVault address of the vault
     * @param offChainQuoteHash hash of the off chain quote to be invalidated
     */
    function invalidateOffChainQuote(
        address lenderVault,
        bytes32 offChainQuoteHash
    ) external;

    /**
     * @notice function performs checks on quote and, if valid, updates quotehandler's state
     * @dev function can only be called by borrowerGateway
     * @param borrower address of borrower
     * @param lenderVault address of the vault
     * @param onChainQuote data for the onChain quote (See notes in DataTypesPeerToPeer.sol)
     */
    function checkAndRegisterOnChainQuote(
        address borrower,
        address lenderVault,
        DataTypesPeerToPeer.OnChainQuote memory onChainQuote
    ) external;

    /**
     * @notice function performs checks on quote and, if valid, updates quotehandler's state
     * @dev function can only be called by borrowerGateway
     * @param borrower address of borrower
     * @param lenderVault address of the vault
     * @param offChainQuote data for the offChain quote (See notes in DataTypesPeerToPeer.sol)
     * @param quoteTuple quote data (see notes in DataTypesPeerToPeer.sol)
     * @param proof array of bytes needed to verify merkle proof
     */
    function checkAndRegisterOffChainQuote(
        address borrower,
        address lenderVault,
        DataTypesPeerToPeer.OffChainQuote calldata offChainQuote,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple,
        bytes32[] memory proof
    ) external;

    /**
     * @notice function to return address of registry
     * @return registry address
     */
    function addressRegistry() external view returns (address);

    /**
     * @notice function to return the current nonce for offchain quotes
     * @param lender address for which nonce is being retrieved
     * @return current value of nonce
     */
    function offChainQuoteNonce(address lender) external view returns (uint256);

    /**
     * @notice function returns if offchain quote hash is invalidated
     * @param lenderVault address of vault
     * @param hashToCheck hash of the offchain quote
     * @return true if invalidated, else false
     */
    function offChainQuoteIsInvalidated(
        address lenderVault,
        bytes32 hashToCheck
    ) external view returns (bool);

    /**
     * @notice function returns if hash is for an on chain quote
     * @param lenderVault address of vault
     * @param hashToCheck hash of the on chain quote
     * @return true if hash belongs to a valid on-chain quote, else false
     */
    function isOnChainQuote(
        address lenderVault,
        bytes32 hashToCheck
    ) external view returns (bool);
}
