// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {Ownable} from "../Ownable.sol";

contract AddressRegistry is Ownable, IAddressRegistry {
    bool private isInitialized;
    address public lenderVaultFactory;
    address public borrowerGateway;
    address public quoteHandler;
    mapping(address => bool) public isRegisteredVault;
    mapping(address => bool) public isWhitelistedToken;
    mapping(address => bool) public isWhitelistedCallbackAddr;
    mapping(address => bool) public isWhitelistedCollTokenHandler;
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
            revert();
        }
        if (
            _lenderVaultFactory == address(0) ||
            _borrowerGateway == address(0) ||
            _quoteHandler == address(0)
        ) {
            revert();
        }
        if (
            _lenderVaultFactory == _borrowerGateway ||
            _lenderVaultFactory == _quoteHandler ||
            _borrowerGateway == _quoteHandler
        ) {
            revert();
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

    function toggleCollTokenHandler(
        address addr,
        bool whitelistStatus
    ) external {
        checkSenderAndIsInitialized();
        isWhitelistedCollTokenHandler[addr] = whitelistStatus;
    }

    function toggleOracle(address addr, bool whitelistStatus) external {
        checkSenderAndIsInitialized();
        isWhitelistedOracle[addr] = whitelistStatus;
    }

    function addLenderVault(address addr) external {
        if (!isInitialized) {
            revert();
        }
        if (isRegisteredVault[addr]) {
            revert();
        }
        isRegisteredVault[addr] = true;
        registeredVaults.push(addr);
    }

    function owner() external view returns (address) {
        return _owner;
    }

    function checkSenderAndIsInitialized() internal view {
        senderCheckOwner();
        if (!isInitialized) {
            revert();
        }
    }
}
