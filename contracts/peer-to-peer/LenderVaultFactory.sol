// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Errors} from "../Errors.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {ILenderVaultFactory} from "./interfaces/ILenderVaultFactory.sol";
import {ILenderVaultImpl} from "./interfaces/ILenderVaultImpl.sol";
import {IMysoTokenManager} from "../interfaces/IMysoTokenManager.sol";

contract LenderVaultFactory is ILenderVaultFactory {
    address public immutable addressRegistry;
    address public immutable lenderVaultImpl;

    constructor(address _addressRegistry, address _lenderVaultImpl) {
        if (_addressRegistry == address(0) || _lenderVaultImpl == address(0)) {
            revert Errors.InvalidAddress();
        }
        addressRegistry = _addressRegistry;
        lenderVaultImpl = _lenderVaultImpl;
    }

    function createVault() external returns (address newLenderVaultAddr) {
        uint256 numRegisteredVaults = IAddressRegistry(addressRegistry)
            .registeredVaults()
            .length;
        bytes32 salt = keccak256(
            abi.encodePacked(lenderVaultImpl, msg.sender, numRegisteredVaults)
        );
        newLenderVaultAddr = Clones.cloneDeterministic(lenderVaultImpl, salt);
        address mysoTokenManager = IAddressRegistry(addressRegistry)
            .mysoTokenManager();
        if (mysoTokenManager != address(0)) {
            IMysoTokenManager(mysoTokenManager).processP2PCreateVault(
                numRegisteredVaults,
                msg.sender,
                newLenderVaultAddr
            );
        }
        ILenderVaultImpl(newLenderVaultAddr).initialize(
            msg.sender,
            addressRegistry
        );
        IAddressRegistry(addressRegistry).addLenderVault(newLenderVaultAddr);
        emit NewVaultCreated(newLenderVaultAddr, msg.sender);
    }
}
