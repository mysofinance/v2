// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Constants} from "../Constants.sol";
import {DataTypesPeerToPeer} from "./DataTypesPeerToPeer.sol";
import {Errors} from "../Errors.sol";
import {Helpers} from "../Helpers.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {ILenderVaultImpl} from "./interfaces/ILenderVaultImpl.sol";
import {IQuoteHandler} from "./interfaces/IQuoteHandler.sol";

contract QuoteHandler is IQuoteHandler {
    using ECDSA for bytes32;

    address public immutable addressRegistry;
    mapping(address => uint256) public offChainQuoteNonce;
    mapping(address => mapping(bytes32 => bool))
        public offChainQuoteIsInvalidated;
    mapping(address => mapping(bytes32 => bool)) public isOnChainQuote;

    constructor(address _addressRegistry) {
        if (_addressRegistry == address(0)) {
            revert Errors.InvalidAddress();
        }
        addressRegistry = _addressRegistry;
    }

    function addOnChainQuote(
        address lenderVault,
        DataTypesPeerToPeer.OnChainQuote calldata onChainQuote
    ) external {
        IAddressRegistry registry = IAddressRegistry(addressRegistry);
        if (!registry.isRegisteredVault(lenderVault)) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
        if (!_isValidOnChainQuote(onChainQuote, registry)) {
            revert Errors.InvalidQuote();
        }
        mapping(bytes32 => bool)
            storage isOnChainQuoteFromVault = isOnChainQuote[lenderVault];
        bytes32 onChainQuoteHash = _hashOnChainQuote(onChainQuote);
        if (isOnChainQuoteFromVault[onChainQuoteHash]) {
            revert Errors.OnChainQuoteAlreadyAdded();
        }
        isOnChainQuoteFromVault[onChainQuoteHash] = true;
        emit OnChainQuoteAdded(lenderVault, onChainQuote, onChainQuoteHash);
    }

    function updateOnChainQuote(
        address lenderVault,
        DataTypesPeerToPeer.OnChainQuote calldata oldOnChainQuote,
        DataTypesPeerToPeer.OnChainQuote calldata newOnChainQuote
    ) external {
        IAddressRegistry registry = IAddressRegistry(addressRegistry);
        if (!registry.isRegisteredVault(lenderVault)) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
        if (!_isValidOnChainQuote(newOnChainQuote, registry)) {
            revert Errors.InvalidQuote();
        }
        mapping(bytes32 => bool)
            storage isOnChainQuoteFromVault = isOnChainQuote[lenderVault];
        bytes32 onChainQuoteHash = _hashOnChainQuote(oldOnChainQuote);
        if (!isOnChainQuoteFromVault[onChainQuoteHash]) {
            revert Errors.UnknownOnChainQuote();
        }
        isOnChainQuoteFromVault[onChainQuoteHash] = false;
        emit OnChainQuoteDeleted(lenderVault, onChainQuoteHash);
        onChainQuoteHash = _hashOnChainQuote(newOnChainQuote);
        isOnChainQuoteFromVault[onChainQuoteHash] = true;
        emit OnChainQuoteAdded(lenderVault, newOnChainQuote, onChainQuoteHash);
    }

    function deleteOnChainQuote(
        address lenderVault,
        DataTypesPeerToPeer.OnChainQuote calldata onChainQuote
    ) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
        mapping(bytes32 => bool)
            storage isOnChainQuoteFromVault = isOnChainQuote[lenderVault];
        bytes32 onChainQuoteHash = _hashOnChainQuote(onChainQuote);
        if (!isOnChainQuoteFromVault[onChainQuoteHash]) {
            revert Errors.UnknownOnChainQuote();
        }
        isOnChainQuoteFromVault[onChainQuoteHash] = false;
        emit OnChainQuoteDeleted(lenderVault, onChainQuoteHash);
    }

    function incrementOffChainQuoteNonce(address lenderVault) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
        uint256 newNonce = offChainQuoteNonce[lenderVault] + 1;
        offChainQuoteNonce[lenderVault] = newNonce;
        emit OffChainQuoteNonceIncremented(lenderVault, newNonce);
    }

    function invalidateOffChainQuote(
        address lenderVault,
        bytes32 offChainQuoteHash
    ) external {
        if (!IAddressRegistry(addressRegistry).isRegisteredVault(lenderVault)) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
        offChainQuoteIsInvalidated[lenderVault][offChainQuoteHash] = true;
        emit OffChainQuoteInvalidated(lenderVault, offChainQuoteHash);
    }

    function checkAndRegisterOnChainQuote(
        address borrower,
        address lenderVault,
        uint256 quoteTupleIdx,
        DataTypesPeerToPeer.OnChainQuote calldata onChainQuote
    ) external {
        _checkSenderAndQuoteInfo(
            borrower,
            onChainQuote.generalQuoteInfo,
            onChainQuote.quoteTuples[quoteTupleIdx]
        );
        mapping(bytes32 => bool)
            storage isOnChainQuoteFromVault = isOnChainQuote[lenderVault];
        bytes32 onChainQuoteHash = _hashOnChainQuote(onChainQuote);
        if (!isOnChainQuoteFromVault[onChainQuoteHash]) {
            revert Errors.UnknownOnChainQuote();
        }
        if (onChainQuote.generalQuoteInfo.isSingleUse) {
            isOnChainQuoteFromVault[onChainQuoteHash] = false;
            emit OnChainQuoteInvalidated(lenderVault, onChainQuoteHash);
        }
        uint256 nextLoanIdx = ILenderVaultImpl(lenderVault).totalNumLoans();
        emit OnChainQuoteUsed(
            lenderVault,
            onChainQuoteHash,
            nextLoanIdx,
            quoteTupleIdx
        );
    }

    function checkAndRegisterOffChainQuote(
        address borrower,
        address lenderVault,
        DataTypesPeerToPeer.OffChainQuote calldata offChainQuote,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple,
        bytes32[] calldata proof
    ) external {
        _checkSenderAndQuoteInfo(
            borrower,
            offChainQuote.generalQuoteInfo,
            quoteTuple
        );
        if (offChainQuote.nonce < offChainQuoteNonce[lenderVault]) {
            revert Errors.InvalidQuote();
        }
        mapping(bytes32 => bool)
            storage offChainQuoteFromVaultIsInvalidated = offChainQuoteIsInvalidated[
                lenderVault
            ];
        bytes32 offChainQuoteHash = _hashOffChainQuote(
            offChainQuote,
            lenderVault
        );
        if (offChainQuoteFromVaultIsInvalidated[offChainQuoteHash]) {
            revert Errors.OffChainQuoteHasBeenInvalidated();
        }
        if (
            !_areValidSignatures(
                lenderVault,
                offChainQuoteHash,
                offChainQuote.compactSigs
            )
        ) {
            revert Errors.InvalidOffChainSignature();
        }

        bytes32 leaf = keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        quoteTuple.loanPerCollUnitOrLtv,
                        quoteTuple.interestRatePctInBase,
                        quoteTuple.upfrontFeePctInBase,
                        quoteTuple.tenor
                    )
                )
            )
        );
        if (!MerkleProof.verify(proof, offChainQuote.quoteTuplesRoot, leaf)) {
            revert Errors.InvalidOffChainMerkleProof();
        }
        if (offChainQuote.generalQuoteInfo.isSingleUse) {
            offChainQuoteFromVaultIsInvalidated[offChainQuoteHash] = true;
            emit OffChainQuoteInvalidated(lenderVault, offChainQuoteHash);
        }
        uint256 nextLoanIdx = ILenderVaultImpl(lenderVault).totalNumLoans();
        emit OffChainQuoteUsed(
            lenderVault,
            offChainQuoteHash,
            nextLoanIdx,
            quoteTuple
        );
    }

    /**
     * @dev The passed signatures must be sorted such that
     * recovered addresses (cast to uint160) are increasing.
     */
    function _areValidSignatures(
        address lenderVault,
        bytes32 offChainQuoteHash,
        bytes[] calldata compactSigs
    ) internal view returns (bool) {
        if (
            compactSigs.length < ILenderVaultImpl(lenderVault).minNumOfSigners()
        ) {
            return false;
        }
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                offChainQuoteHash
            )
        );
        address recoveredSigner;
        address prevSigner;
        for (uint256 i = 0; i < compactSigs.length; ) {
            (bytes32 r, bytes32 vs) = Helpers.splitSignature(compactSigs[i]);
            recoveredSigner = messageHash.recover(r, vs);
            if (!ILenderVaultImpl(lenderVault).isSigner(recoveredSigner)) {
                return false;
            }
            if (recoveredSigner <= prevSigner) {
                return false;
            }
            prevSigner = recoveredSigner;
            unchecked {
                i++;
            }
        }
        return true;
    }

    function _hashOffChainQuote(
        DataTypesPeerToPeer.OffChainQuote memory offChainQuote,
        address lenderVault
    ) internal view returns (bytes32 quoteHash) {
        quoteHash = keccak256(
            abi.encode(
                offChainQuote.generalQuoteInfo,
                offChainQuote.quoteTuplesRoot,
                offChainQuote.salt,
                offChainQuote.nonce,
                lenderVault,
                block.chainid
            )
        );
    }

    function _checkSenderAndQuoteInfo(
        address borrower,
        DataTypesPeerToPeer.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple
    ) internal view {
        IAddressRegistry registry = IAddressRegistry(addressRegistry);
        if (msg.sender != registry.borrowerGateway()) {
            revert Errors.InvalidSender();
        }
        _checkTokensAndCompartmentWhitelist(
            generalQuoteInfo.collToken,
            generalQuoteInfo.loanToken,
            registry,
            generalQuoteInfo.borrowerCompartmentImplementation,
            _isSwap(generalQuoteInfo, quoteTuple)
        );
        if (generalQuoteInfo.validUntil < block.timestamp) {
            revert Errors.OutdatedQuote();
        }
        if (
            generalQuoteInfo.collToken == generalQuoteInfo.loanToken ||
            generalQuoteInfo.maxLoan == 0 ||
            generalQuoteInfo.minLoan > generalQuoteInfo.maxLoan
        ) {
            revert Errors.InvalidQuote();
        }
        if (
            generalQuoteInfo.whitelistAddr != address(0) &&
            ((generalQuoteInfo.isWhitelistAddrSingleBorrower &&
                generalQuoteInfo.whitelistAddr != borrower) ||
                (!generalQuoteInfo.isWhitelistAddrSingleBorrower &&
                    !registry.isWhitelistedBorrower(
                        generalQuoteInfo.whitelistAddr,
                        borrower
                    )))
        ) {
            revert Errors.InvalidBorrower();
        }
    }

    function _isValidOnChainQuote(
        DataTypesPeerToPeer.OnChainQuote calldata onChainQuote,
        IAddressRegistry registry
    ) internal view returns (bool) {
        if (
            onChainQuote.generalQuoteInfo.collToken ==
            onChainQuote.generalQuoteInfo.loanToken
        ) {
            return false;
        }
        if (onChainQuote.quoteTuples.length == 0) {
            return false;
        }
        if (onChainQuote.generalQuoteInfo.validUntil < block.timestamp) {
            return false;
        }
        if (
            onChainQuote.generalQuoteInfo.maxLoan == 0 ||
            onChainQuote.generalQuoteInfo.minLoan >
            onChainQuote.generalQuoteInfo.maxLoan
        ) {
            return false;
        }
        bool isSwap;
        for (uint256 k = 0; k < onChainQuote.quoteTuples.length; ) {
            (bool isValid, bool isSwapCurr) = _isValidOnChainQuoteTuple(
                onChainQuote.generalQuoteInfo,
                onChainQuote.quoteTuples[k]
            );
            if (!isValid) {
                return false;
            }
            if (isSwapCurr && onChainQuote.quoteTuples.length > 1) {
                return false;
            }
            if (k > 0 && isSwap != isSwapCurr) {
                return false;
            }
            isSwap = isSwapCurr;
            unchecked {
                k++;
            }
        }
        _checkTokensAndCompartmentWhitelist(
            onChainQuote.generalQuoteInfo.collToken,
            onChainQuote.generalQuoteInfo.loanToken,
            registry,
            onChainQuote.generalQuoteInfo.borrowerCompartmentImplementation,
            isSwap
        );
        return true;
    }

    function _checkTokensAndCompartmentWhitelist(
        address collToken,
        address loanToken,
        IAddressRegistry registry,
        address compartmentImpl,
        bool isSwap
    ) internal view {
        if (
            !registry.isWhitelistedERC20(loanToken) ||
            !registry.isWhitelistedERC20(collToken)
        ) {
            revert Errors.NonWhitelistedToken();
        }

        if (isSwap) {
            if (compartmentImpl != address(0)) {
                revert Errors.InvalidSwap();
            }
            return;
        }
        if (compartmentImpl == address(0)) {
            DataTypesPeerToPeer.WhitelistState collTokenWhitelistState = registry
                    .whitelistState(collToken);
            if (
                collTokenWhitelistState ==
                DataTypesPeerToPeer
                    .WhitelistState
                    .ERC20_TOKEN_REQUIRING_COMPARTMENT
            ) {
                revert Errors.CollateralMustBeCompartmentalized();
            }
        } else {
            if (
                !registry.isWhitelistedCompartment(compartmentImpl, collToken)
            ) {
                revert Errors.InvalidCompartmentForToken();
            }
        }
    }

    function _hashOnChainQuote(
        DataTypesPeerToPeer.OnChainQuote memory onChainQuote
    ) internal pure returns (bytes32 quoteHash) {
        quoteHash = keccak256(abi.encode(onChainQuote));
    }

    function _isValidOnChainQuoteTuple(
        DataTypesPeerToPeer.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple
    ) internal pure returns (bool, bool) {
        bool isSwap = _isSwap(generalQuoteInfo, quoteTuple);
        if (quoteTuple.upfrontFeePctInBase < Constants.BASE) {
            // note: if upfrontFee<100% this corresponds to a loan; check that tenor and earliest repay are consistent
            if (
                quoteTuple.tenor <
                generalQuoteInfo.earliestRepayTenor +
                    Constants.MIN_TIME_BETWEEN_EARLIEST_REPAY_AND_EXPIRY
            ) {
                return (false, isSwap);
            }
        } else if (quoteTuple.upfrontFeePctInBase == Constants.BASE) {
            // note: if upfrontFee=100% this corresponds to an outright swap; check other fields are consistent
            if (!isSwap) {
                return (false, isSwap);
            }
        } else {
            // note: if upfrontFee>100% this is invalid
            return (false, isSwap);
        }

        if (quoteTuple.loanPerCollUnitOrLtv == 0) {
            return (false, isSwap);
        }
        // If the oracle address is set, the LTV can only be set to a value > 1 (undercollateralized)
        // when there is a specified whitelist address.
        // Otherwise, the LTV must be set to a value <= 100% (overcollateralized).
        if (
            generalQuoteInfo.oracleAddr != address(0) &&
            quoteTuple.loanPerCollUnitOrLtv > Constants.BASE &&
            generalQuoteInfo.whitelistAddr == address(0)
        ) {
            return (false, isSwap);
        }
        if (quoteTuple.interestRatePctInBase + int(Constants.BASE) <= 0) {
            return (false, isSwap);
        }
        return (true, isSwap);
    }

    function _isSwap(
        DataTypesPeerToPeer.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypesPeerToPeer.QuoteTuple calldata quoteTuple
    ) internal pure returns (bool) {
        return
            quoteTuple.upfrontFeePctInBase == Constants.BASE &&
            quoteTuple.tenor + generalQuoteInfo.earliestRepayTenor == 0 &&
            quoteTuple.interestRatePctInBase == 0 &&
            generalQuoteInfo.borrowerCompartmentImplementation == address(0);
    }
}
