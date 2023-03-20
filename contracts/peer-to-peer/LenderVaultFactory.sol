// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ILenderVaultImpl} from "./interfaces/ILenderVaultImpl.sol";
import {ILenderVaultFactory} from "./interfaces/ILenderVaultFactory.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {IEvents} from "./interfaces/IEvents.sol";

contract LenderVaultFactory is IEvents, ILenderVaultFactory {
    address public immutable addressRegistry;
    address public immutable lenderVaultImpl;

    constructor(address _addressRegistry, address _lenderVaultImpl) {
        addressRegistry = _addressRegistry;
        lenderVaultImpl = _lenderVaultImpl;
    }

    function createVault() external returns (address newLenderVaultAddr) {
        uint256 numRegisteredVaults = IAddressRegistry(addressRegistry)
            .registeredVaultLength();
        bytes32 salt = keccak256(
            abi.encodePacked(lenderVaultImpl, msg.sender, numRegisteredVaults)
        );
        newLenderVaultAddr = Clones.cloneDeterministic(lenderVaultImpl, salt);
        ILenderVaultImpl(newLenderVaultAddr).initialize(
            msg.sender,
            addressRegistry
        );
        IAddressRegistry(addressRegistry).addLenderVault(newLenderVaultAddr);
        emit NewVaultCreated(newLenderVaultAddr, msg.sender);
    }
}
