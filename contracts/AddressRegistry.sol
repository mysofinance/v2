// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";

contract AddressRegistry is IAddressRegistry {
    address public owner;
    address public lenderVaultFactory;
    address public borrowerGateway;
    address public quoteHandler;
    mapping(address => bool) public isRegisteredVault;
    mapping(address => bool) public isWhitelistedToken;
    mapping(address => bool) public isWhitelistedCallbackAddr;
    mapping(address => bool) public isWhitelistedCollTokenHandler;
    mapping(address => bool) public isWhitelistedAutoQuoteStrategy;
    mapping(address => bool) public isWhitelistedOracle;
    address[] public registeredVaults;

    constructor() {
        owner = msg.sender;
    }

    function initialize(
        address _lenderVaultFactory,
        address _borrowerGateway,
        address _quoteHandler
    ) external {
        if (msg.sender != owner) {
            revert();
        }
        if (
            lenderVaultFactory != address(0) ||
            borrowerGateway != address(0) ||
            quoteHandler != address(0)
        ) {
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
    }

    function toggleTokens(address[] memory tokens) external {
        if (msg.sender != owner) {
            revert();
        }
        for (uint i = 0; i < tokens.length; i++) {
            if (tokens[i] != address(0)) {
                isWhitelistedToken[tokens[i]] = !isWhitelistedToken[tokens[i]];
            }
            unchecked {
                i++;
            }
        }
    }

    function toggleCallbackAddr(address addr) external {
        if (msg.sender != owner) {
            revert();
        }
        isWhitelistedCallbackAddr[addr] = !isWhitelistedCallbackAddr[addr];
    }

    function toggleCollTokenHandler(address addr) external {
        if (msg.sender != owner) {
            revert();
        }
        isWhitelistedCollTokenHandler[addr] = !isWhitelistedCollTokenHandler[
            addr
        ];
    }

    function toggleAutoQuoteStrategy(address addr) external {
        if (msg.sender != owner) {
            revert();
        }
        isWhitelistedAutoQuoteStrategy[addr] = !isWhitelistedAutoQuoteStrategy[
            addr
        ];
    }

    function toggleOracle(address addr) external {
        if (msg.sender != owner) {
            revert();
        }
        isWhitelistedOracle[addr] = !isWhitelistedOracle[addr];
    }

    function addLenderVault(address addr) external {
        if (msg.sender != lenderVaultFactory) {
            revert();
        }
        if (isRegisteredVault[addr]) {
            revert();
        }
        isRegisteredVault[addr] = true;
        registeredVaults.push(addr);
    }

    function isWhitelistedTokenPair(
        address collToken,
        address loanToken
    ) external view returns (bool) {
        return
            !(isWhitelistedToken[collToken] && isWhitelistedToken[loanToken]);
    }
}
