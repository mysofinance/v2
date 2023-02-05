// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import {IVaultFlashCallback} from "./interfaces/IVaultFlashCallback.sol";
import {ICompartmentFactory} from "./interfaces/ICompartmentFactory.sol";
import {ICompartment} from "./interfaces/ICompartment.sol";
import {ILenderFactory} from "./interfaces/ILenderFactory.sol";
import {DataTypes} from "./DataTypes.sol";

contract LenderFactory is ReentrancyGuard, ILenderFactory {
    using SafeERC20 for IERC20Metadata;

    error InvalidCompartmentAddr();
    error InvalidSender();

    mapping(address => bool) public registeredVaults;
    mapping(DataTypes.WhiteListType => mapping(address => bool))
        public whitelistedAddrs;

    address public factoryController;
    address public newFactoryController;

    constructor() {
        factoryController = msg.sender;
    }

    function proposeNewController(address _newController) external {
        if (msg.sender != factoryController || _newController == address(0)) {
            revert InvalidSender();
        }
        newFactoryController = _newController;
    }

    function claimControl() external {
        if (msg.sender != newFactoryController) {
            revert InvalidSender();
        }
        factoryController = newFactoryController;
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
        if (!registeredVaults[msg.sender]) revert InvalidSender();
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
        // had to do in one transaction instead of separate collTokenBalAfter for stack depth...
        initCollAmount = uint128(
            IERC20Metadata(loan.collToken).balanceOf(
                _predictedNewCompartmentAddress
            ) - collTokenBalBefore
        );

        compartmentAddr = ICompartmentFactory(compartmentFactory)
            .createCompartment(
                implAddr,
                address(this),
                msg.sender,
                loan.collToken,
                numLoans,
                data
            );
        if (compartmentAddr != _predictedNewCompartmentAddress) {
            revert InvalidCompartmentAddr();
        }
    }
}
