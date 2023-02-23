// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import {DataTypes} from "./DataTypes.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {ILenderVault} from "./interfaces/ILenderVault.sol";
import "hardhat/console.sol";

contract QuoteHandler {
    using SafeERC20 for IERC20Metadata;

    uint256 constant BASE = 1e18;
    address addressRegistry;
    mapping(address => uint256) offChainQuoteNonce;
    mapping(address => mapping(bytes32 => bool)) offChainQuoteIsInvalidated;
    mapping(address => mapping(bytes32 => bool)) public isOnChainQuote;
    mapping(address => mapping(address => bool))
        public isActiveAutoQuoteStrategy;

    event OnChainQuote(
        address lenderVault,
        DataTypes.Quote quote,
        bytes32 onChainQuoteHash,
        bool isActive
    );

    constructor(address _addressRegistry) {
        addressRegistry = _addressRegistry;
    }

    function addOnChainQuote(
        address lenderVault,
        DataTypes.Quote calldata quote
    ) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert();
        }
        if (ILenderVault(lenderVault).vaultOwner() != msg.sender) {
            revert();
        }
        if (!isValidQuote(quote)) {
            revert();
        }
        if (
            !IAddressRegistry(addressRegistry).isWhitelistedTokenPair(
                quote.collToken,
                quote.loanToken
            )
        ) {
            revert();
        }
        bytes32 onChainQuoteHash = hashOnChainQuote(quote);
        if (isOnChainQuote[lenderVault][onChainQuoteHash]) {
            revert();
        }
        isOnChainQuote[lenderVault][onChainQuoteHash] = true;
        emit OnChainQuote(lenderVault, quote, onChainQuoteHash, true);
    }

    function updateOnChainQuote(
        address lenderVault,
        DataTypes.Quote calldata oldQuote,
        DataTypes.Quote calldata newQuote
    ) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert();
        }
        if (ILenderVault(lenderVault).vaultOwner() != msg.sender) {
            revert();
        }
        if (!isValidQuote(newQuote)) {
            revert();
        }
        if (
            !IAddressRegistry(addressRegistry).isWhitelistedTokenPair(
                newQuote.collToken,
                newQuote.loanToken
            )
        ) {
            revert();
        }
        bytes32 onChainQuoteHash = hashOnChainQuote(oldQuote);
        if (!isOnChainQuote[lenderVault][onChainQuoteHash]) {
            revert();
        }
        isOnChainQuote[lenderVault][onChainQuoteHash] = false;
        emit OnChainQuote(lenderVault, oldQuote, onChainQuoteHash, false);
        onChainQuoteHash = hashOnChainQuote(newQuote);
        isOnChainQuote[lenderVault][onChainQuoteHash] = true;
        emit OnChainQuote(lenderVault, newQuote, onChainQuoteHash, true);
    }

    function deleteOnChainQuote(
        address lenderVault,
        DataTypes.Quote calldata quote
    ) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert();
        }
        if (ILenderVault(lenderVault).vaultOwner() != msg.sender) {
            revert();
        }
        bytes32 onChainQuoteHash = hashOnChainQuote(quote);
        if (!isOnChainQuote[lenderVault][onChainQuoteHash]) {
            revert();
        }
        isOnChainQuote[lenderVault][onChainQuoteHash] = false;
        emit OnChainQuote(lenderVault, quote, onChainQuoteHash, false);
    }

    function addAutoQuoteStrategy() external {}

    function doesAcceptOnChainQuote(
        address borrower,
        address lenderVault,
        DataTypes.Quote memory quote
    ) external view returns (bool) {
        if (
            !IAddressRegistry(addressRegistry).isWhitelistedTokenPair(
                quote.collToken,
                quote.loanToken
            )
        ) {
            return false;
        }
        if (quote.borrower != address(0) && quote.borrower != borrower) {
            return false;
        }
        return isOnChainQuote[lenderVault][hashOnChainQuote(quote)];
    }

    function doesAcceptAutoQuote(
        address borrower,
        address /*lenderVault*/,
        DataTypes.Quote memory quote
    ) external view returns (bool) {
        if (
            !IAddressRegistry(addressRegistry).isWhitelistedTokenPair(
                quote.collToken,
                quote.loanToken
            )
        ) {
            return false;
        }
        if (quote.borrower != address(0) && quote.borrower != borrower) {
            return false;
        }
        return false;
        /*
        return
            autoQuoteStrategy[onChainQuote.quote.collToken][onChainQuote.quote.loanToken] !=
            address(0);
        */
    }

    function doesAcceptOffChainQuote(
        address borrower,
        address lenderVault,
        DataTypes.OffChainQuote calldata offChainQuote
    ) external view returns (bool) {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert();
        }
        if (
            !IAddressRegistry(addressRegistry).isWhitelistedTokenPair(
                offChainQuote.quote.collToken,
                offChainQuote.quote.loanToken
            )
        ) {
            return false;
        }
        if (
            offChainQuote.quote.borrower != address(0) &&
            offChainQuote.quote.borrower != borrower
        ) {
            return false;
        }
        if (offChainQuote.nonce > offChainQuoteNonce[lenderVault]) {
            return false;
        }
        bytes32 offChainQuoteHash = hashOffChainQuote(offChainQuote);
        if (offChainQuoteIsInvalidated[lenderVault][offChainQuoteHash]) {
            return false;
        }
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                offChainQuoteHash
            )
        );
        address recoveredSigner = ecrecover(
            messageHash,
            offChainQuote.v,
            offChainQuote.r,
            offChainQuote.s
        );
        if (
            recoveredSigner != ILenderVault(lenderVault).vaultOwner() ||
            offChainQuote.quote.validUntil < block.timestamp
        ) {
            return false;
        }
        return true;
    }

    function incrementOffChainQuoteNonce(address lenderVault) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert();
        }
        if (ILenderVault(lenderVault).vaultOwner() != msg.sender) {
            revert();
        }
        offChainQuoteNonce[lenderVault] += 1;
    }

    function invalidateOffChainQuote(
        address lenderVault,
        bytes32 offChainQuoteHash
    ) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert();
        }
        if (ILenderVault(lenderVault).vaultOwner() != msg.sender) {
            revert();
        }
        offChainQuoteIsInvalidated[lenderVault][offChainQuoteHash] = true;
    }

    function hashOnChainQuote(
        DataTypes.Quote memory quote
    ) public pure returns (bytes32 quoteHash) {
        quoteHash = keccak256(abi.encode(quote));
    }

    function hashOffChainQuote(
        DataTypes.OffChainQuote memory offChainQuote
    ) public pure returns (bytes32 quoteHash) {
        quoteHash = keccak256(
            abi.encode(offChainQuote.quote, offChainQuote.nonce)
        );
    }

    function isValidQuote(
        DataTypes.Quote calldata quote
    ) public view returns (bool) {
        console.log("PASS 1");
        if (quote.collToken == quote.loanToken) {
            return false;
        }
        console.log("PASS 2");
        console.log("PASS 3");
        if (
            quote.quoteTuples.loanPerCollUnitOrLtv.length !=
            quote.quoteTuples.tenor.length ||
            quote.quoteTuples.loanPerCollUnitOrLtv.length !=
            quote.quoteTuples.interestRatePctInBase.length ||
            quote.quoteTuples.loanPerCollUnitOrLtv.length !=
            quote.quoteTuples.upfrontFeePctInBase.length
        ) {
            return false;
        }
        console.log("PASS 4");
        console.log("PASS 5");
        if (quote.validUntil < block.timestamp) {
            return false;
        }
        console.log("PASS 6");
        for (
            uint256 k = 0;
            k < quote.quoteTuples.loanPerCollUnitOrLtv.length;

        ) {
            if (quote.quoteTuples.upfrontFeePctInBase[k] > BASE) {
                return false;
            }
            console.log("PASS 7");
            if (
                quote.oracleAddr != address(0) &&
                quote.quoteTuples.loanPerCollUnitOrLtv[k] >= BASE
            ) {
                return false;
            }
            console.log("PASS 8");
            if (
                quote.quoteTuples.isNegativeInterestRate &&
                quote.quoteTuples.interestRatePctInBase[k] > BASE
            ) {
                return false;
            }
            console.log("PASS 9");
            unchecked {
                k++;
            }
        }
        return true;
    }

    function fromQuoteToLoanInfo(
        address borrower,
        uint256 collSendAmount,
        uint256 expectedTransferFee,
        DataTypes.Quote calldata quote,
        uint256 quoteTupleIdx
    ) external view returns (DataTypes.Loan memory loan, uint256 upfrontFee) {
        loan.borrower = borrower;
        if (collSendAmount < expectedTransferFee) {
            revert(); // InsufficientSendAmount();
        }
        if (quote.oracleAddr != address(0)) {
            revert(); // ToDo: implement oracle handling
        }
        if (quoteTupleIdx > quote.quoteTuples.loanPerCollUnitOrLtv.length) {
            revert();
        }
        uint256 loanAmount = (quote.quoteTuples.loanPerCollUnitOrLtv[
            quoteTupleIdx
        ] * (collSendAmount - expectedTransferFee)) /
            (10 ** IERC20Metadata(quote.collToken).decimals());
        uint256 repayAmount;
        if (quote.quoteTuples.isNegativeInterestRate) {
            repayAmount =
                (loanAmount *
                    (BASE -
                        quote.quoteTuples.interestRatePctInBase[
                            quoteTupleIdx
                        ])) /
                BASE;
        } else {
            repayAmount =
                (loanAmount *
                    (BASE +
                        quote.quoteTuples.interestRatePctInBase[
                            quoteTupleIdx
                        ])) /
                BASE;
        }
        upfrontFee =
            (collSendAmount *
                quote.quoteTuples.upfrontFeePctInBase[quoteTupleIdx]) /
            BASE;
        // minimum coll amount to prevent griefing attacks or small unlocks that aren't worth it
        if (loanAmount < quote.minLoan || loanAmount > quote.maxLoan) {
            revert(); // revert InsufficientSendAmount();
        }
        loan.loanToken = quote.loanToken;
        loan.collToken = quote.collToken;
        loan.initCollAmount = toUint128(
            collSendAmount - upfrontFee - expectedTransferFee
        );
        loan.initLoanAmount = toUint128(loanAmount);
        loan.initRepayAmount = toUint128(repayAmount);
        loan.expiry = uint40(
            block.timestamp + quote.quoteTuples.tenor[quoteTupleIdx]
        );
        loan.earliestRepay = uint40(
            block.timestamp + quote.quoteTuples.earliestRepayTenor
        );
        if (quote.borrowerCompartmentImplementation != address(0)) {
            loan = setCompartmentLoanData(
                quote.borrowerCompartmentImplementation,
                borrower,
                loan
            );
        }
    }

    function setCompartmentLoanData(
        address borrowerCompartmentImplementation,
        address borrower,
        DataTypes.Loan memory loan
    ) internal view returns (DataTypes.Loan memory) {
        bytes32 salt = keccak256(
            abi.encodePacked(
                borrowerCompartmentImplementation,
                address(this),
                borrower
                //_loans.length // ToDo: use unique loan id (either pass from lenderVault or call from QuoteHandler)
            )
        );
        loan.collTokenCompartmentAddr = Clones.predictDeterministicAddress(
            borrowerCompartmentImplementation,
            salt,
            IAddressRegistry(address(0)).borrowerCompartmentFactory()
        );
        return loan;
    }

    function toUint128(uint256 x) internal pure returns (uint128 y) {
        y = uint128(x);
        if (y != x) {
            revert();
        }
    }
}
