// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {IEvents} from "./interfaces/IEvents.sol";
import {Ownable} from "../Ownable.sol";
import {Errors} from "../Errors.sol";

contract AddressRegistry is Ownable, IAddressRegistry, IEvents {
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
            if (tokens[i] == address(0)) {
                revert Errors.InvalidAddress();
            }
            isWhitelistedToken[tokens[i]] = whitelistStatus;
            unchecked {
                i++;
            }
        }
        emit WhitelistAddressToggled(
            tokens,
            whitelistStatus,
            IEvents.EventToggleType.TOKEN
        );
    }

    function toggleCallbackAddr(address addr, bool whitelistStatus) external {
        checkSenderAndIsInitialized();
        isWhitelistedCallbackAddr[addr] = whitelistStatus;
        prepareToggleEvent(
            addr,
            whitelistStatus,
            IEvents.EventToggleType.CALLBACK
        );
    }

    function toggleCompartmentImpl(
        address addr,
        bool whitelistStatus
    ) external {
        checkSenderAndIsInitialized();
        isWhitelistedCompartmentImpl[addr] = whitelistStatus;
        prepareToggleEvent(
            addr,
            whitelistStatus,
            IEvents.EventToggleType.COMPARTMENT
        );
    }

    function toggleOracle(address addr, bool whitelistStatus) external {
        checkSenderAndIsInitialized();
        isWhitelistedOracle[addr] = whitelistStatus;
        prepareToggleEvent(
            addr,
            whitelistStatus,
            IEvents.EventToggleType.ORACLE
        );
    }

    function addLenderVault(address addr) external {
        // catches case where address registry is uninitialized (lenderVaultFactory == 0)
        if (msg.sender != lenderVaultFactory) {
            revert Errors.InvalidSender();
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

    function registeredVaultLength() external view returns (uint256) {
        return registeredVaults.length;
    }

    function prepareToggleEvent(
        address toggledAddr,
        bool whitelistStatus,
        IEvents.EventToggleType toggleType
    ) internal {
        address[] memory addressToggled = new address[](1);
        addressToggled[0] = toggledAddr;
        emit WhitelistAddressToggled(
            addressToggled,
            whitelistStatus,
            toggleType
        );
    }

    function checkSenderAndIsInitialized() internal view {
        senderCheckOwner();
        if (!isInitialized) {
            revert Errors.Uninitialized();
        }
    }
}
