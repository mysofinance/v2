// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import {DataTypes} from "../DataTypes.sol";

interface ILenderVault {
    function initialize(
        address compartmentFactory,
        address lenderVaultFactory
    ) external;

    function invalidateQuotes() external returns (uint256);

    function setAutoQuoteStrategy(
        address collToken,
        address loanToken,
        address strategyAddr
    ) external;

    // don't need to verify that collToken is a valid whitelisted token cause that
    // would not be allowed through on the orders anyways
    function setCollTokenImpl(
        address collToken,
        address collTokenImplAddr
    ) external;

    function withdraw(address token, uint256 amount, address owner) external;

    function setOnChainQuote(
        DataTypes.OnChainQuote calldata onChainQuote,
        DataTypes.OnChainQuote calldata oldOnChainQuote,
        DataTypes.OnChainQuoteUpdateType onChainQuoteUpdateType,
        uint256 oldOnChainQuoteId
    ) external;

    function borrowWithOnChainQuote(
        address borrower,
        DataTypes.OnChainQuote memory onChainQuote,
        bool isAutoQuote,
        uint256 sendAmount,
        address callbackAddr,
        bytes calldata data
    ) external;

    function borrowWithOffChainQuote(
        address borrower,
        DataTypes.OffChainQuote calldata loanOffChainQuote,
        address callbackAddr,
        bytes calldata data
    ) external;

    function repay(
        address borrower,
        DataTypes.LoanRepayInfo calldata loanRepayInfo,
        address callbackAddr,
        bytes calldata data
    ) external;

    function unlockCollateral(
        address owner,
        address collToken,
        uint256[] calldata _loanIds
    ) external;

    function getVaultInfo()
        external
        view
        returns (
            uint256 _currLoanId,
            uint256 _loanOffChainQuoteNonce,
            uint256 _numOnChainQuotes,
            address _compartmentFactory,
            address _lenderFactory
        );

    function loans(uint256 index) external view returns (DataTypes.Loan memory);

    function onChainQuotes(
        uint256 index
    ) external view returns (DataTypes.OnChainQuote memory);
}
