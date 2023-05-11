// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Constants} from "../Constants.sol";
import {DataTypesPeerToPeer} from "./DataTypesPeerToPeer.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {ILenderVaultImpl} from "./interfaces/ILenderVaultImpl.sol";
import {IQuoteHandler} from "./interfaces/IQuoteHandler.sol";
import {Errors} from "../Errors.sol";

contract QuoteHandler is IQuoteHandler {
    address public immutable addressRegistry;
    mapping(address => uint256) public offChainQuoteNonce;
    mapping(address => mapping(bytes32 => bool))
        public offChainQuoteIsInvalidated;
    mapping(address => mapping(bytes32 => bool)) public isOnChainQuote;

    constructor(address _addressRegistry) {
        addressRegistry = _addressRegistry;
    }

    function addOnChainQuote(
        address lenderVault,
        DataTypesPeerToPeer.OnChainQuote calldata onChainQuote
    ) external {
        address _addressRegistry = addressRegistry;
        if (
            !IAddressRegistry(_addressRegistry).isRegisteredVault(lenderVault)
        ) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
        if (!isValidOnChainQuote(onChainQuote)) {
            revert Errors.InvalidQuote();
        }
        if (
            IAddressRegistry(_addressRegistry).whitelistState(
                onChainQuote.generalQuoteInfo.collToken
            ) !=
            DataTypesPeerToPeer.WhitelistState.TOKEN ||
            IAddressRegistry(_addressRegistry).whitelistState(
                onChainQuote.generalQuoteInfo.loanToken
            ) !=
            DataTypesPeerToPeer.WhitelistState.TOKEN
        ) {
            revert Errors.NonWhitelistedToken();
        }
        bytes32 onChainQuoteHash = hashOnChainQuote(onChainQuote);
        if (isOnChainQuote[lenderVault][onChainQuoteHash]) {
            revert Errors.OnChainQuoteAlreadyAdded();
        }
        isOnChainQuote[lenderVault][onChainQuoteHash] = true;
        emit OnChainQuoteAdded(lenderVault, onChainQuote, onChainQuoteHash);
    }

    function updateOnChainQuote(
        address lenderVault,
        DataTypesPeerToPeer.OnChainQuote calldata oldOnChainQuote,
        DataTypesPeerToPeer.OnChainQuote calldata newOnChainQuote
    ) external {
        address _addressRegistry = addressRegistry;
        if (
            !IAddressRegistry(_addressRegistry).isRegisteredVault(lenderVault)
        ) {
            revert Errors.UnregisteredVault();
        }
        if (ILenderVaultImpl(lenderVault).owner() != msg.sender) {
            revert Errors.InvalidSender();
        }
        if (!isValidOnChainQuote(newOnChainQuote)) {
            revert Errors.InvalidQuote();
        }
        if (
            IAddressRegistry(_addressRegistry).whitelistState(
                newOnChainQuote.generalQuoteInfo.collToken
            ) !=
            DataTypesPeerToPeer.WhitelistState.TOKEN ||
            IAddressRegistry(_addressRegistry).whitelistState(
                newOnChainQuote.generalQuoteInfo.loanToken
            ) !=
            DataTypesPeerToPeer.WhitelistState.TOKEN
        ) {
            revert Errors.NonWhitelistedToken();
        }
        bytes32 onChainQuoteHash = hashOnChainQuote(oldOnChainQuote);
        if (!isOnChainQuote[lenderVault][onChainQuoteHash]) {
            revert Errors.UnknownOnChainQuote();
        }
        isOnChainQuote[lenderVault][onChainQuoteHash] = false;
        emit OnChainQuoteDeleted(lenderVault, onChainQuoteHash);
        onChainQuoteHash = hashOnChainQuote(newOnChainQuote);
        isOnChainQuote[lenderVault][onChainQuoteHash] = true;
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
        bytes32 onChainQuoteHash = hashOnChainQuote(onChainQuote);
        if (!isOnChainQuote[lenderVault][onChainQuoteHash]) {
            revert Errors.UnknownOnChainQuote();
        }
        isOnChainQuote[lenderVault][onChainQuoteHash] = false;
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
        checkSenderAndGeneralQuoteInfo(borrower, onChainQuote.generalQuoteInfo);
        bytes32 onChainQuoteHash = hashOnChainQuote(onChainQuote);
        if (!isOnChainQuote[lenderVault][onChainQuoteHash]) {
            revert Errors.UnknownOnChainQuote();
        }
        if (onChainQuote.generalQuoteInfo.isSingleUse) {
            isOnChainQuote[lenderVault][onChainQuoteHash] = false;
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
        bytes32[] memory proof
    ) external {
        checkSenderAndGeneralQuoteInfo(
            borrower,
            offChainQuote.generalQuoteInfo
        );
        if (
            offChainQuote.nonce < offChainQuoteNonce[lenderVault] ||
            offChainQuote.generalQuoteInfo.validUntil < block.timestamp
        ) {
            revert Errors.InvalidQuote();
        }
        bytes32 offChainQuoteHash = hashOffChainQuote(
            offChainQuote,
            lenderVault
        );
        if (offChainQuoteIsInvalidated[lenderVault][offChainQuoteHash]) {
            revert Errors.OffChainQuoteHasBeenInvalidated();
        }
        if (
            !areValidSignatures(
                lenderVault,
                offChainQuoteHash,
                offChainQuote.v,
                offChainQuote.r,
                offChainQuote.s
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
            offChainQuoteIsInvalidated[lenderVault][offChainQuoteHash] = true;
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

    function areValidSignatures(
        address lenderVault,
        bytes32 offChainQuoteHash,
        uint8[] calldata v,
        bytes32[] calldata r,
        bytes32[] calldata s
    ) internal view returns (bool) {
        if (
            v.length != r.length ||
            v.length != s.length ||
            v.length != ILenderVaultImpl(lenderVault).minNumOfSigners()
        ) {
            return false;
        }
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                offChainQuoteHash
            )
        );
        uint256 tmp;
        address recoveredSigner;
        uint256 newHash;
        for (uint256 i = 0; i < v.length; ) {
            recoveredSigner = ecrecover(messageHash, v[i], r[i], s[i]);
            // use hash instead of address to spread out over 256 bits and reduce false positives
            newHash = uint256(keccak256(abi.encode(recoveredSigner)));
            if (tmp == tmp | newHash) {
                return false;
            }

            if (!ILenderVaultImpl(lenderVault).isSigner(recoveredSigner)) {
                return false;
            }
            tmp |= newHash;
            unchecked {
                i++;
            }
        }
        return true;
    }

    function hashOffChainQuote(
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

    function checkSenderAndGeneralQuoteInfo(
        address borrower,
        DataTypesPeerToPeer.GeneralQuoteInfo calldata generalQuoteInfo
    ) internal view {
        address _addressRegistry = addressRegistry;
        if (
            msg.sender != IAddressRegistry(_addressRegistry).borrowerGateway()
        ) {
            revert Errors.InvalidSender();
        }
        DataTypesPeerToPeer.WhitelistState collWhitelistState = IAddressRegistry(
                _addressRegistry
            ).whitelistState(generalQuoteInfo.collToken);
        DataTypesPeerToPeer.WhitelistState loanWhitelistState = IAddressRegistry(
                _addressRegistry
            ).whitelistState(generalQuoteInfo.loanToken);
        if (
            (collWhitelistState != DataTypesPeerToPeer.WhitelistState.TOKEN &&
                collWhitelistState !=
                DataTypesPeerToPeer
                    .WhitelistState
                    .COMPARTMENTALIZE_IF_COLLATERAL) ||
            (loanWhitelistState != DataTypesPeerToPeer.WhitelistState.TOKEN &&
                loanWhitelistState !=
                DataTypesPeerToPeer
                    .WhitelistState
                    .COMPARTMENTALIZE_IF_COLLATERAL)
        ) {
            revert Errors.NonWhitelistedToken();
        }
        if (
            collWhitelistState ==
            DataTypesPeerToPeer.WhitelistState.COMPARTMENTALIZE_IF_COLLATERAL &&
            generalQuoteInfo.borrowerCompartmentImplementation == address(0)
        ) {
            revert Errors.CollateralMustBeCompartmentalized();
        }
        if (generalQuoteInfo.collToken == generalQuoteInfo.loanToken) {
            revert Errors.InvalidQuote();
        }
        if (
            generalQuoteInfo.borrower != address(0) &&
            generalQuoteInfo.borrower != borrower
        ) {
            revert Errors.InvalidBorrower();
        }
    }

    function isValidOnChainQuote(
        DataTypesPeerToPeer.OnChainQuote calldata onChainQuote
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
        for (uint256 k = 0; k < onChainQuote.quoteTuples.length; ) {
            if (
                onChainQuote.quoteTuples[k].upfrontFeePctInBase > Constants.BASE
            ) {
                return false;
            }
            if (
                onChainQuote.generalQuoteInfo.oracleAddr != address(0) &&
                onChainQuote.quoteTuples[k].loanPerCollUnitOrLtv >=
                Constants.BASE
            ) {
                return false;
            }
            if (
                onChainQuote.quoteTuples[k].interestRatePctInBase +
                    int(Constants.BASE) <=
                0
            ) {
                return false;
            }
            if (
                onChainQuote.quoteTuples[k].tenor <=
                onChainQuote.generalQuoteInfo.earliestRepayTenor
            ) {
                return false;
            }
            unchecked {
                k++;
            }
        }
        return true;
    }

    function hashOnChainQuote(
        DataTypesPeerToPeer.OnChainQuote memory onChainQuote
    ) internal pure returns (bytes32 quoteHash) {
        quoteHash = keccak256(abi.encode(onChainQuote));
    }
}
