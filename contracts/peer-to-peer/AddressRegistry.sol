// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {DataTypesPeerToPeer} from "./DataTypesPeerToPeer.sol";
import {Errors} from "../Errors.sol";
import {Ownable} from "../Ownable.sol";

/**
 * @dev AddressRegistry is a contract that stores addresses of other contracts and controls whitelist state
 * IMPORTANT: This contract allows for de-whitelisting as well. This is an important security feature because if
 * a contract or token is found to present a vulnerability, it can be de-whitelisted to prevent further borrowing
 * with that token (repays and withdrawals would still be allowed). In the limit of a total de-whitelisting of all
 * tokens, all borrowing in the protocol would be paused. This feature can also be utilized if a fork with the same chainId is found.
 */
contract AddressRegistry is Ownable, IAddressRegistry {
    bool internal isInitialized;
    address public lenderVaultFactory;
    address public borrowerGateway;
    address public quoteHandler;
    mapping(address => bool) public isRegisteredVault;
    mapping(address => DataTypesPeerToPeer.WhitelistState)
        public whitelistState;
    // token => compartment => isAllowed
    mapping(address => mapping(address => bool))
        public isAllowedCompartmentForToken;
    address[] internal _registeredVaults;

    constructor() {
        _owner = msg.sender;
    }

    function initialize(
        address _lenderVaultFactory,
        address _borrowerGateway,
        address _quoteHandler
    ) external {
        senderCheckOwner();
        if (isInitialized) {
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
        isInitialized = true;
    }

    function setWhitelistState(
        address[] memory addrs,
        DataTypesPeerToPeer.WhitelistState _whitelistState
    ) external {
        checkSenderAndIsInitialized();
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

    function setStateOfCompartmentForToken(
        address[] calldata tokens,
        address[] calldata compartmentImpls,
        bool[] calldata isAllowed
    ) external {
        checkSenderAndIsInitialized();
        if (
            tokens.length == 0 ||
            tokens.length != compartmentImpls.length ||
            tokens.length != isAllowed.length
        ) {
            revert Errors.InvalidArrayLength();
        }
        for (uint i = 0; i < tokens.length; ) {
            if (tokens[i] == address(0) || compartmentImpls[i] == address(0)) {
                revert Errors.InvalidAddress();
            }
            isAllowedCompartmentForToken[tokens[i]][
                compartmentImpls[i]
            ] = isAllowed[i];
            unchecked {
                i++;
            }
        }
        emit AllowedCompartmentForTokenUpdated(
            tokens,
            compartmentImpls,
            isAllowed
        );
    }

    function addLenderVault(address addr) external {
        // catches case where address registry is uninitialized (lenderVaultFactory == address(0))
        if (msg.sender != lenderVaultFactory) {
            revert Errors.InvalidSender();
        }
        isRegisteredVault[addr] = true;
        _registeredVaults.push(addr);
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

    function checkSenderAndIsInitialized() internal view {
        senderCheckOwner();
        if (!isInitialized) {
            revert Errors.Uninitialized();
        }
    }
}
