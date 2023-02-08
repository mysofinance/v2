// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import {DataTypes} from "../DataTypes.sol";

interface ILenderVault {
    function initialize(
        address vaultOwner,
        address compartmentFactory,
        address lenderVaultFactory
    ) external;

    function loans(uint256 index) external view returns (DataTypes.Loan memory);

    function isValidOnChainQuote(
        DataTypes.OnChainQuote calldata onChainQuote
    ) external view returns (bool isValid);

    function isValidAutoQuote(
        DataTypes.OnChainQuote calldata onChainQuote
    ) external view returns (bool isValid);

    function isValidOffChainQuote(
        address borrower,
        DataTypes.OffChainQuote calldata offChainQuote
    ) external view returns (bool isValid, bytes32 offChainQuoteHash);

    function getLoanInfoForOnChainQuote(
        address borrower,
        uint256 collSendAmount,
        DataTypes.OnChainQuote calldata onChainQuote
    ) external returns (DataTypes.Loan memory loan, uint256 upfrontFee);

    function getLoanInfoForOffChainQuote(
        address borrower,
        DataTypes.OffChainQuote calldata offChainQuote
    ) external returns (DataTypes.Loan memory loan, uint256 upfrontFee);

    function addLoan(DataTypes.Loan memory loan) external;

    function invalidateOffChainQuote(bytes32 offChainQuoteHash) external;
}
