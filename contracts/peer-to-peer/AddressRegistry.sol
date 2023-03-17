// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {Ownable} from "../Ownable.sol";
import {Errors} from "../Errors.sol";

contract AddressRegistry is Ownable, IAddressRegistry {
    bool internal isInitialized;
    address public lenderVaultFactory;
    address public borrowerGateway;
    address public quoteHandler;
    mapping(address => bool) public isRegisteredVault;
    mapping(address => bool) public isWhitelistedToken;
    mapping(address => bool) public isWhitelistedCallbackAddr;
    mapping(address => bool) public isWhitelistedCompartmentImpl;
    mapping(address => bool) public isWhitelistedOracle;
    address[] public registeredVaults;

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

    function toggleTokens(
        address[] memory tokens,
        bool whitelistStatus
    ) external {
        checkSenderAndIsInitialized();
        for (uint i = 0; i < tokens.length; ) {
            if (tokens[i] != address(0)) {
                isWhitelistedToken[tokens[i]] = whitelistStatus;
            }
            unchecked {
                i++;
            }
        }
    }

    function toggleCallbackAddr(address addr, bool whitelistStatus) external {
        checkSenderAndIsInitialized();
        isWhitelistedCallbackAddr[addr] = whitelistStatus;
    }

    function toggleCompartmentImpl(
        address addr,
        bool whitelistStatus
    ) external {
        checkSenderAndIsInitialized();
        isWhitelistedCompartmentImpl[addr] = whitelistStatus;
    }

    function toggleOracle(address addr, bool whitelistStatus) external {
        checkSenderAndIsInitialized();
        isWhitelistedOracle[addr] = whitelistStatus;
    }

    function addLenderVault(address addr) external {
        if (msg.sender != lenderVaultFactory) {
            revert Errors.InvalidSender();
        }
        if (!isInitialized) {
            revert Errors.Uninitialized();
        }
        if (isRegisteredVault[addr]) {
            revert Errors.AlreadyRegisteredVault();
        }
        isRegisteredVault[addr] = true;
        registeredVaults.push(addr);
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
