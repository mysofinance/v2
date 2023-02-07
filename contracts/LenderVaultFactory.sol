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
import {DataTypes} from "./DataTypes.sol";

contract LenderVaultFactory is ILenderVaultFactory {
    using SafeERC20 for IERC20Metadata;

    error InvalidCompartmentAddr();
    error InvalidIndex();
    error InvalidSender();
    error InvalidFactory();
    error InvalidVaultAddr();
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

    function createCompartment(
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

    function InvalidateQuotes(address vaultAddr) external {
        checkVaultOwner(vaultAddr);
        uint256 updatedNonce = ILenderVault(vaultAddr).invalidateQuotes();
        emit UpdatedOffChainQuoteNonce(vaultAddr, updatedNonce);
    }

    function setAutoQuoteStrategy(
        address vaultAddr,
        address collToken,
        address loanToken,
        address strategyAddr
    ) external {
        checkVaultOwner(vaultAddr);
        whitelistCheck(DataTypes.WhiteListType.STRATEGY, strategyAddr);
        ILenderVault(vaultAddr).setAutoQuoteStrategy(
            collToken,
            loanToken,
            strategyAddr
        );
        emit AutoQuoteStrategy(vaultAddr, collToken, loanToken, strategyAddr);
    }

    function setCollTokenImpl(
        address vaultAddr,
        address collToken,
        address collTokenImplAddr
    ) external {
        checkVaultOwner(vaultAddr);
        whitelistCheck(DataTypes.WhiteListType.COMPARTMENT, collTokenImplAddr);
        ILenderVault(vaultAddr).setCollTokenImpl(collToken, collTokenImplAddr);
        emit CollTokenCompartmentImpl(vaultAddr, collToken, collTokenImplAddr);
    }

    function withdraw(
        address vaultAddr,
        address token,
        uint256 amount
    ) external {
        checkVaultOwner(vaultAddr);
        whitelistCheck(DataTypes.WhiteListType.TOKEN, token);
        ILenderVault(vaultAddr).withdraw(token, amount, vaultOwner[vaultAddr]);
    }

    function setOnChainQuote(
        address vaultAddr,
        DataTypes.OnChainQuote calldata onChainQuote,
        DataTypes.OnChainQuoteUpdateType onChainQuoteUpdateType,
        uint256 oldOnChainQuoteId
    ) external {
        checkVaultOwner(vaultAddr);
        DataTypes.OnChainQuote memory oldOnChainQuote;
        if (onChainQuoteUpdateType != DataTypes.OnChainQuoteUpdateType.ADD) {
            (, , uint256 numOnChainQuotes, , ) = ILenderVault(vaultAddr)
                .getVaultInfo();
            if (
                numOnChainQuotes == 0 ||
                oldOnChainQuoteId > numOnChainQuotes - 1
            ) revert InvalidIndex();
            oldOnChainQuote = ILenderVault(vaultAddr).onChainQuotes(
                oldOnChainQuoteId
            );
        }
        if (onChainQuoteUpdateType != DataTypes.OnChainQuoteUpdateType.DELETE) {
            whitelistCheck(
                DataTypes.WhiteListType.TOKEN,
                onChainQuote.loanToken
            );
            whitelistCheck(
                DataTypes.WhiteListType.TOKEN,
                onChainQuote.collToken
            );
        }
        ILenderVault(vaultAddr).setOnChainQuote(
            onChainQuote,
            oldOnChainQuote,
            onChainQuoteUpdateType,
            oldOnChainQuoteId
        );
        if (onChainQuoteUpdateType != DataTypes.OnChainQuoteUpdateType.ADD) {
            emit OnChainQuote(
                vaultAddr,
                oldOnChainQuote,
                onChainQuoteUpdateType,
                false
            );
        }
        if (onChainQuoteUpdateType != DataTypes.OnChainQuoteUpdateType.DELETE) {
            emit OnChainQuote(
                vaultAddr,
                onChainQuote,
                onChainQuoteUpdateType,
                true
            );
        }
    }

    function borrowWithOnChainQuote(
        address vaultAddr,
        DataTypes.OnChainQuote memory onChainQuote,
        bool isAutoQuote,
        uint256 sendAmount,
        address callbackAddr,
        bytes calldata data
    ) external {
        if (callbackAddr != address(0)) {
            whitelistCheck(DataTypes.WhiteListType.CALLBACK, callbackAddr);
        }
        if (!isRegisteredVault[vaultAddr]) revert InvalidVaultAddr();
        ILenderVault(vaultAddr).borrowWithOnChainQuote(
            msg.sender,
            onChainQuote,
            isAutoQuote,
            sendAmount,
            callbackAddr,
            data
        );
        // emit event here...
    }

    function borrowWithOffChainQuote(
        address vaultAddr,
        DataTypes.OffChainQuote calldata loanOffChainQuote,
        address callbackAddr,
        bytes calldata data
    ) external {
        if (callbackAddr != address(0)) {
            whitelistCheck(DataTypes.WhiteListType.CALLBACK, callbackAddr);
        }
        if (!isRegisteredVault[vaultAddr]) revert InvalidVaultAddr();
        whitelistCheck(
            DataTypes.WhiteListType.TOKEN,
            loanOffChainQuote.loanToken
        );
        whitelistCheck(
            DataTypes.WhiteListType.TOKEN,
            loanOffChainQuote.collToken
        );
        ILenderVault(vaultAddr).borrowWithOffChainQuote(
            msg.sender,
            loanOffChainQuote,
            callbackAddr,
            data
        );
        // emit event here...
    }

    function repay(
        address vaultAddr,
        DataTypes.LoanRepayInfo calldata loanRepayInfo,
        address callbackAddr,
        bytes calldata data
    ) external {
        if (callbackAddr != address(0)) {
            whitelistCheck(DataTypes.WhiteListType.CALLBACK, callbackAddr);
        }
        if (!isRegisteredVault[vaultAddr]) revert InvalidVaultAddr();
        ILenderVault(vaultAddr).repay(
            msg.sender,
            loanRepayInfo,
            callbackAddr,
            data
        );
        //emit event here...
    }

    function unlockCollateral(
        address vaultAddr,
        address collToken,
        uint256[] calldata _loanIds
    ) external {
        address owner = vaultOwner[vaultAddr];
        if (owner == address(0)) revert InvalidVaultAddr();
        whitelistCheck(DataTypes.WhiteListType.TOKEN, collToken);
        ILenderVault(vaultAddr).unlockCollateral(owner, collToken, _loanIds);
        //emit event here...
    }

    function checkVaultOwner(address vaultAddr) internal view {
        if (vaultOwner[vaultAddr] != msg.sender) revert InvalidSender();
    }

    function whitelistCheck(
        DataTypes.WhiteListType _type,
        address _addrToCheck
    ) internal view {
        if (!whitelistedAddrs[_type][_addrToCheck]) revert Invalid();
    }
}
