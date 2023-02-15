// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

contract AddressRegistry {
    address public owner;
    address public lenderVaultFactory;
    address public borrowerGateway;
    address public borrowerCompartmentFactory;
    mapping(address => bool) public isRegisteredVault;
    mapping(address => bool) public isWhitelistedToken;
    //mapping(address => mapping(address => bool)) isWhitelistedTokenPair;
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

    function setBorrowerCompartmentFactory(address addr) external {
        if (msg.sender != owner) {
            revert();
        }
        if (borrowerCompartmentFactory != address(0)) {
            revert();
        }
        borrowerCompartmentFactory = addr;
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
