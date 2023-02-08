// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

contract AddressRegistry {
    address public owner;
    address public lenderVaultFactory;
    address public borrowerGateway;
    mapping(address => bool) public isRegisteredVault;
    mapping(address => mapping(address => bool)) public isWhitelistedTokenPair;
    mapping(address => bool) public isWhitelistedCallbackAddr;
    mapping(address => bool) public isWhitelistedCollTokenHandler;
    mapping(address => bool) public isWhitelistedAutoQuoteStrategy;
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

    function toggleTokenPair(address collToken, address loanToken) external {
        if (msg.sender != owner) {
            revert();
        }
        isWhitelistedTokenPair[collToken][loanToken] = !isWhitelistedTokenPair[
            collToken
        ][loanToken];
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
}
