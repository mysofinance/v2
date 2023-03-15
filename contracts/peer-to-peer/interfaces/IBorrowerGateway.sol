// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypes} from "../DataTypes.sol";

interface IBorrowerGateway {
    function addressRegistry() external view returns (address);

    function protocolFee() external view returns (uint256);

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
        DataTypes.LoanRepayInfo calldata loanRepayInfo,
        address vaultAddr,
        address callbackAddr,
        bytes calldata callbackData
    ) external;

    function setNewProtocolFee(uint256 _newFee) external;
}
