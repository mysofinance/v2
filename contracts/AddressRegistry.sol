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

    function setLenderVaultFactory(address addr) external {
        if (msg.sender != owner) {
            revert();
        }
        if (lenderVaultFactory != address(0)) {
            revert();
        }
        lenderVaultFactory = addr;
    }

    function setBorrowerGateway(address addr) external {
        if (msg.sender != owner) {
            revert();
        }
        if (borrowerGateway != address(0)) {
            revert();
        }
        borrowerGateway = addr;
    }

    function setQuoteHandler(address addr) external {
        if (msg.sender != owner) {
            revert();
        }
        if (quoteHandler != address(0)) {
            revert();
        }
        quoteHandler = addr;
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
