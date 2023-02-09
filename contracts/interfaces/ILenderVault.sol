// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import {DataTypes} from "../DataTypes.sol";

interface ILenderVault {
    function initialize(address vaultOwner, address addressRegistry) external;

    function vaultOwner() external view returns (address);

    function loans(
        uint256 index
    ) external view returns (DataTypes.Loan memory loan);

    function doesAcceptOnChainQuote(
        DataTypes.OnChainQuote calldata onChainQuote
    ) external view returns (bool doesAccept);

    function doesAcceptAutoQuote(
        DataTypes.OnChainQuote calldata onChainQuote
    ) external view returns (bool doesAccept);

    function doesAcceptOffChainQuote(
        address borrower,
        DataTypes.OffChainQuote calldata offChainQuote
    ) external view returns (bool doesAccept, bytes32 offChainQuoteHash);

    function getLoanInfoForOnChainQuote(
        address borrower,
        uint256 collSendAmount,
        DataTypes.OnChainQuote calldata onChainQuote
    ) external returns (DataTypes.Loan memory loan, uint256 upfrontFee);

    function getLoanInfoForOffChainQuote(
        address borrower,
        DataTypes.OffChainQuote calldata offChainQuote
    ) external returns (DataTypes.Loan memory loan, uint256 upfrontFee);

    function addLoan(
        DataTypes.Loan memory loan
    ) external returns (uint256 loanId);

    function invalidateOffChainQuote(bytes32 offChainQuoteHash) external;

    function transferTo(
        address token,
        address recipient,
        uint256 amount
    ) external;
}
