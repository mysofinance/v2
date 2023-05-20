// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {DataTypesPeerToPeer} from "./DataTypesPeerToPeer.sol";
import {Errors} from "../Errors.sol";
import {Ownable} from "../Ownable.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {INftWrapper} from "./interfaces/wrappers/ERC721/INftWrapper.sol";

/**
 * @dev AddressRegistry is a contract that stores addresses of other contracts and controls whitelist state
 * IMPORTANT: This contract allows for de-whitelisting as well. This is an important security feature because if
 * a contract or token is found to present a vulnerability, it can be de-whitelisted to prevent further borrowing
 * with that token (repays and withdrawals would still be allowed). In the limit of a total de-whitelisting of all
 * tokens, all borrowing in the protocol would be paused. This feature can also be utilized if a fork with the same chainId is found.
 */
contract AddressRegistry is Ownable, IAddressRegistry {
    using ECDSA for bytes32;

    bool internal _isInitialized;
    address public lenderVaultFactory;
    address public borrowerGateway;
    address public quoteHandler;
    address public mysoTokenManager;
    address public erc721TokenWrapper;
    mapping(address => bool) public isRegisteredVault;
    mapping(address => mapping(address => uint256))
        internal _borrowerWhitelistedUntil;
    mapping(address => DataTypesPeerToPeer.WhitelistState)
        public whitelistState;
    // compartment => token => active
    mapping(address => mapping(address => bool))
        internal _isTokenWhitelistedForCompartment;
    address[] internal _registeredVaults;

    function initialize(
        address _lenderVaultFactory,
        address _borrowerGateway,
        address _quoteHandler
    ) external {
        _senderCheckOwner();
        if (_isInitialized) {
            revert Errors.AlreadyInitialized();
        }
        if (
            _lenderVaultFactory == address(0) ||
            _borrowerGateway == address(0) ||
            _quoteHandler == address(0)
        ) {
            revert Errors.InvalidAddress();
        }
        if (
            _lenderVaultFactory == _borrowerGateway ||
            _lenderVaultFactory == _quoteHandler ||
            _borrowerGateway == _quoteHandler
        ) {
            revert Errors.DuplicateAddresses();
        }
        lenderVaultFactory = _lenderVaultFactory;
        borrowerGateway = _borrowerGateway;
        quoteHandler = _quoteHandler;
        _isInitialized = true;
    }

    function setWhitelistState(
        address[] calldata addrs,
        DataTypesPeerToPeer.WhitelistState _whitelistState
    ) external {
        _checkSenderAndIsInitialized();
        for (uint i = 0; i < addrs.length; ) {
            if (addrs[i] == address(0)) {
                revert Errors.InvalidAddress();
            }
            whitelistState[addrs[i]] = _whitelistState;
            unchecked {
                i++;
            }
        }
        emit WhitelistStateUpdated(addrs, _whitelistState);
    }

    function setWhitelistedTokensForCompartment(
        address compartmentImpl,
        address[] calldata tokens,
        bool isWhitelisted
    ) external {
        _checkSenderAndIsInitialized();
        // check that tokens can only be whitelisted for valid compartment (whereas de-whitelisting is always possible)
        if (
            isWhitelisted &&
            whitelistState[compartmentImpl] !=
            DataTypesPeerToPeer.WhitelistState.COMPARTMENT
        ) {
            revert Errors.NonWhitelistedCompartment();
        }
        if (tokens.length == 0) {
            revert Errors.InvalidArrayLength();
        }
        for (uint i = 0; i < tokens.length; ) {
            if (
                isWhitelisted &&
                whitelistState[tokens[i]] !=
                DataTypesPeerToPeer.WhitelistState.TOKEN
            ) {
                revert Errors.NonWhitelistedToken();
            }
            _isTokenWhitelistedForCompartment[compartmentImpl][
                tokens[i]
            ] = isWhitelisted;
            unchecked {
                i++;
            }
        }
        emit TokenWhitelistForCompartmentUpdated(
            compartmentImpl,
            tokens,
            isWhitelisted
        );
    }

    function setMysoTokenManager(address newTokenManager) external {
        _senderCheckOwner();
        address oldTokenManager = mysoTokenManager;
        if (oldTokenManager == newTokenManager) {
            revert Errors.InvalidAddress();
        }
        mysoTokenManager = newTokenManager;
        emit MysoTokenManagerUpdated(oldTokenManager, newTokenManager);
    }

    function setTokenWrapperContract(address newTokenWrapper) external {
        _senderCheckOwner();
        address oldTokenWrapper = erc721TokenWrapper;
        if (oldTokenWrapper == newTokenWrapper) {
            revert Errors.InvalidAddress();
        }
        erc721TokenWrapper = newTokenWrapper;
        emit TokenWrapperContractUpdated(oldTokenWrapper, newTokenWrapper);
    }

    function addLenderVault(address addr) external {
        // catches case where address registry is uninitialized (lenderVaultFactory == address(0))
        if (msg.sender != lenderVaultFactory) {
            revert Errors.InvalidSender();
        }
        isRegisteredVault[addr] = true;
        _registeredVaults.push(addr);
    }

    function claimBorrowerWhitelistStatus(
        address whitelistAuthority,
        uint256 whitelistedUntil,
        bytes memory signature,
        bytes32 salt
    ) external {
        bytes32 payloadHash = keccak256(
            abi.encode(msg.sender, whitelistedUntil, block.chainid, salt)
        );
        bytes32 messageHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", payloadHash)
        );
        address recoveredSigner = messageHash.recover(signature);
        if (
            whitelistAuthority == address(0) ||
            recoveredSigner != whitelistAuthority
        ) {
            revert Errors.InvalidSignature();
        }
        if (
            whitelistedUntil < block.timestamp ||
            whitelistedUntil <=
            _borrowerWhitelistedUntil[whitelistAuthority][msg.sender]
        ) {
            revert Errors.CannotClaimOutdatedStatus();
        }
        _borrowerWhitelistedUntil[whitelistAuthority][
            msg.sender
        ] = whitelistedUntil;
        emit BorrowerWhitelistStatusClaimed(
            whitelistAuthority,
            msg.sender,
            whitelistedUntil
        );
    }

    function createWrappedNftToken(
        DataTypesPeerToPeer.NftAddressAndIds[] calldata tokenInfo,
        string calldata name,
        string calldata symbol
    ) external {
        address _erc721TokenWrapper = erc721TokenWrapper;
        if (_erc721TokenWrapper == address(0)) {
            revert Errors.InvalidAddress();
        }
        if (tokenInfo.length == 0) {
            revert Errors.InvalidArrayLength();
        }
        uint160 prevNftAddressCastToUint160;
        uint160 nftAddressCastToUint160;
        uint256 prevId;
        for (uint i = 0; i < tokenInfo.length; ) {
            if (tokenInfo[i].nftIds.length == 0) {
                revert Errors.InvalidArrayLength();
            }
            if (
                whitelistState[tokenInfo[i].nftAddress] !=
                DataTypesPeerToPeer.WhitelistState.NFT
            ) {
                revert Errors.NonWhitelistedToken();
            }
            nftAddressCastToUint160 = uint160(tokenInfo[i].nftAddress);
            if (nftAddressCastToUint160 <= prevNftAddressCastToUint160) {
                revert Errors.NonIncreasingTokenAddrs();
            }
            prevId = 0;
            for (uint j = 0; j < tokenInfo[i].nftIds.length; ) {
                if (tokenInfo[i].nftIds[j] <= prevId && j != 0) {
                    revert Errors.NonIncreasingNonFungibleTokenIds();
                }
                prevId = tokenInfo[i].nftIds[j];
                unchecked {
                    j++;
                }
            }
            prevNftAddressCastToUint160 = nftAddressCastToUint160;
            unchecked {
                i++;
            }
        }
        address newERC20Addr = INftWrapper(_erc721TokenWrapper)
            .createWrappedNftToken(msg.sender, tokenInfo, name, symbol);
        whitelistState[newERC20Addr] = DataTypesPeerToPeer.WhitelistState.TOKEN;
        emit NonFungibleTokensWrapped(tokenInfo, name, symbol, newERC20Addr);
    }

    function updateBorrowerWhitelist(
        address[] memory borrowers,
        uint256 whitelistedUntil
    ) external {
        for (uint i = 0; i < borrowers.length; ) {
            if (
                borrowers[i] == address(0) ||
                whitelistedUntil ==
                _borrowerWhitelistedUntil[msg.sender][borrowers[i]]
            ) {
                revert Errors.InvalidUpdate();
            }
            _borrowerWhitelistedUntil[msg.sender][
                borrowers[i]
            ] = whitelistedUntil;
            unchecked {
                i++;
            }
        }
        emit BorrowerWhitelistUpdated(msg.sender, borrowers, whitelistedUntil);
    }

    function isWhitelistedBorrower(
        address whitelistAuthority,
        address borrower
    ) external view returns (bool) {
        return
            _borrowerWhitelistedUntil[whitelistAuthority][borrower] >
            block.timestamp;
    }

    function isWhitelistedCompartment(
        address compartment,
        address token
    ) external view returns (bool) {
        return
            whitelistState[compartment] ==
            DataTypesPeerToPeer.WhitelistState.COMPARTMENT &&
            _isTokenWhitelistedForCompartment[compartment][token];
    }

    function registeredVaults() external view returns (address[] memory) {
        return _registeredVaults;
    }

    function owner()
        external
        view
        override(Ownable, IAddressRegistry)
        returns (address)
    {
        return _owner;
    }

    function _checkSenderAndIsInitialized() internal view {
        _senderCheckOwner();
        if (!_isInitialized) {
            revert Errors.Uninitialized();
        }
    }
}
