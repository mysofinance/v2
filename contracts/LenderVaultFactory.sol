// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {ILenderVault} from "./interfaces/ILenderVault.sol";
import {ILenderVaultFactory} from "./interfaces/ILenderVaultFactory.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {DataTypes} from "./DataTypes.sol";

contract LenderVaultFactory is ILenderVaultFactory, ReentrancyGuard {
    address public addressRegistry;
    address public lenderVaultImpl;

    constructor(address _addressRegistry, address _lenderVaultImpl) {
        addressRegistry = _addressRegistry;
        lenderVaultImpl = _lenderVaultImpl;
    }

    function createVault()
        external
        nonReentrant
        returns (address newLenderVaultAddr)
    {
        bytes32 salt = keccak256(abi.encodePacked(lenderVaultImpl, msg.sender));
        newLenderVaultAddr = Clones.cloneDeterministic(lenderVaultImpl, salt);
        ILenderVault(newLenderVaultAddr).initialize(
            msg.sender,
            addressRegistry
        );
        IAddressRegistry(addressRegistry).addLenderVault(newLenderVaultAddr);
    }
}
