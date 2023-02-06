// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import {IVaultFlashCallback} from "./interfaces/IVaultFlashCallback.sol";
import {ICompartmentFactory} from "./interfaces/ICompartmentFactory.sol";
import {ICompartment} from "./interfaces/ICompartment.sol";
import {ILenderVault} from "./interfaces/ILenderVault.sol";
import {ILenderVaultFactory} from "./interfaces/ILenderVaultFactory.sol";
import {DataTypes} from "./DataTypes.sol";

contract LenderVaultFactory is ILenderVaultFactory {
    using SafeERC20 for IERC20Metadata;

    error InvalidCompartmentAddr();
    error InvalidSender();
    error InvalidFactory();
    error Invalid();

    mapping(address => bool) public isRegisteredVault;
    address[] public registeredVaults;
    mapping(address => address) public vaultOwner;
    mapping(address => address) public vaultNewOwner;

    mapping(DataTypes.WhiteListType => mapping(address => bool))
        public whitelistedAddrs;

    address public factoryController;
    address public newFactoryController;
    address public lenderVaultImpl;

    constructor(address _lenderVaultImpl) {
        factoryController = msg.sender;
        lenderVaultImpl = _lenderVaultImpl;
    }

    function proposeNewController(address _newController) external {
        if (msg.sender != factoryController || _newController == address(0)) {
            revert InvalidSender();
        }
        newFactoryController = _newController;
    }

    function claimFactoryControl() external {
        if (msg.sender != newFactoryController) {
            revert InvalidSender();
        }
        factoryController = newFactoryController;
    }

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

    function addToWhitelist(
        DataTypes.WhiteListType _type,
        address addrToWhitelist
    ) external {
        if (msg.sender != factoryController || addrToWhitelist == address(0)) {
            revert InvalidSender();
        }
        whitelistedAddrs[_type][addrToWhitelist] = true;
    }

    function createCompartments(
        DataTypes.Loan memory loan,
        uint256 reclaimable,
        address implAddr,
        address compartmentFactory,
        uint256 numLoans,
        bytes memory data
    ) external returns (address compartmentAddr, uint128 initCollAmount) {
        if (!isRegisteredVault[msg.sender]) revert InvalidSender();
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

    function createVault(
        address compartmentFactory
    ) external returns (address) {
        if (
            !whitelistedAddrs[DataTypes.WhiteListType.FACTORY][
                compartmentFactory
            ]
        ) revert InvalidFactory();
        bytes32 salt = keccak256(
            abi.encodePacked(lenderVaultImpl, compartmentFactory, msg.sender)
        );
        address newVaultInstanceAddr = Clones.cloneDeterministic(
            lenderVaultImpl,
            salt
        );

        ILenderVault(newVaultInstanceAddr).initialize(
            compartmentFactory,
            address(this)
        );

        isRegisteredVault[newVaultInstanceAddr] = true;
        registeredVaults.push(newVaultInstanceAddr);
        vaultOwner[newVaultInstanceAddr] = msg.sender;

        return newVaultInstanceAddr;
    }
}
