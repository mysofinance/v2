// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import {IVaultCallback} from "./interfaces/IVaultCallback.sol";
import {ICompartmentFactory} from "./interfaces/ICompartmentFactory.sol";
import {ICompartment} from "./interfaces/ICompartment.sol";
import {ILenderVault} from "./interfaces/ILenderVault.sol";
import {ILenderVaultFactory} from "./interfaces/ILenderVaultFactory.sol";
import {IAddressRegistry} from "./interfaces/IAddressRegistry.sol";
import {DataTypes} from "./DataTypes.sol";

contract LenderVaultFactory is ILenderVaultFactory {
    using SafeERC20 for IERC20Metadata;

    error InvalidCompartmentAddr();
    error InvalidSender();
    error InvalidFactory();
    error Invalid();

    mapping(address => bool) public isRegisteredVault;
    address[] public registeredVaults;

    mapping(DataTypes.WhiteListType => mapping(address => bool))
        public whitelistedAddrs;

    address public addressRegistry;
    address public lenderVaultImpl;
    address public borrowerGateway;
    address compartmentFactory = address(0);

    constructor(address _addressRegistry, address _lenderVaultImpl) {
        addressRegistry = _addressRegistry;
        lenderVaultImpl = _lenderVaultImpl;
    }

    /* TODO: move this to vault
    function proposeNewVaultOwner(
        address vaultAddr,
        address _newOwner
    ) external {
        address currVaultOwner = vaultOwner[vaultAddr];
        if (msg.sender != currVaultOwner || _newOwner == address(0)) {
            revert Invalid();
        }
        vaultNewOwner[vaultAddr] = _newOwner;
    }

    function claimVaultOwnership(address vaultAddr) external {
        address currVaultNewOwner = vaultNewOwner[vaultAddr];
        if (msg.sender != currVaultNewOwner) {
            revert Invalid();
        }
        vaultOwner[vaultAddr] = currVaultNewOwner;
    }
    */

    /* TODO: move this to borrower gateway, as this doesn't directly relate to lender interactions */
    function createCompartment(
        DataTypes.Loan memory loan,
        uint256 reclaimable,
        address implAddr,
        address compartmentFactory,
        uint256 numLoans,
        bytes memory data
    ) external returns (address compartmentAddr, uint128 initCollAmount) {
        //if (!isRegisteredVault[msg.sender]) revert InvalidSender();
        bytes32 salt = keccak256(
            abi.encode(
                implAddr,
                address(this),
                msg.sender,
                loan.collToken,
                numLoans
            )
        );
        address _predictedNewCompartmentAddress = Clones
            .predictDeterministicAddress(implAddr, salt, compartmentFactory);

        uint256 collTokenBalBefore = IERC20Metadata(loan.collToken).balanceOf(
            _predictedNewCompartmentAddress
        );

        // sender is vault
        IERC20Metadata(loan.collToken).safeTransferFrom(
            msg.sender,
            _predictedNewCompartmentAddress,
            reclaimable
        );

        // balance difference in coll token of the vault after...
        // 1) transfer fee into vault on transfer from sender
        // 2) remove upfrontFee
        // 3) transfer fee into compartment from vault
        (compartmentAddr, initCollAmount) = ICompartmentFactory(
            compartmentFactory
        ).createCompartment(
                implAddr,
                address(this),
                msg.sender,
                loan.collToken,
                numLoans,
                collTokenBalBefore,
                data
            );
        if (compartmentAddr != _predictedNewCompartmentAddress) {
            revert InvalidCompartmentAddr();
        }
    }

    function createVault() external returns (address) {
        bytes32 salt = keccak256(
            abi.encodePacked(lenderVaultImpl, compartmentFactory, msg.sender)
        );
        address newVaultInstanceAddr = Clones.cloneDeterministic(
            lenderVaultImpl,
            salt
        );

        ILenderVault(newVaultInstanceAddr).initialize(
            msg.sender,
            addressRegistry,
            compartmentFactory
        );

        IAddressRegistry(addressRegistry).addLenderVault(newVaultInstanceAddr);

        return newVaultInstanceAddr;
    }
}
