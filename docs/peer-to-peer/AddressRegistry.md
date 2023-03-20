# AddressRegistry









## Methods

### addLenderVault

```solidity
function addLenderVault(address addr) external nonpayable
```

adds new lender vault to registry

*can only be called lender vault factory*

#### Parameters

| Name | Type | Description |
|---|---|---|
| addr | address | address of new lender vault |

### borrowerGateway

```solidity
function borrowerGateway() external view returns (address)
```

Returns the address of the borrower gateway




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | Address of the borrower gateway contract |

### claimOwnership

```solidity
function claimOwnership() external nonpayable
```






### initialize

```solidity
function initialize(address _lenderVaultFactory, address _borrowerGateway, address _quoteHandler) external nonpayable
```

initializes factory, gateway, and quote handler contracts



#### Parameters

| Name | Type | Description |
|---|---|---|
| _lenderVaultFactory | address | address of the factory for lender vaults |
| _borrowerGateway | address | address of the gateway with which borrowers interact |
| _quoteHandler | address | address of contract which handles quote logic |

### isRegisteredVault

```solidity
function isRegisteredVault(address) external view returns (bool)
```

Returns boolean flag indicating whether given address is a registered vault



#### Parameters

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | Boolean flag indicating whether given address is a registered vault |

### isWhitelistedCallbackAddr

```solidity
function isWhitelistedCallbackAddr(address) external view returns (bool)
```

Returns boolean flag indicating whether given address is a whitelisted callback contract



#### Parameters

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | Boolean flag indicating whether given address is a whitelisted callback contract |

### isWhitelistedCompartmentImpl

```solidity
function isWhitelistedCompartmentImpl(address) external view returns (bool)
```

Returns boolean flag indicating whether given address is a whitelisted compartment implementation contract



#### Parameters

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | Boolean flag indicating whether given address is a whitelisted compartment implementation contract |

### isWhitelistedOracle

```solidity
function isWhitelistedOracle(address) external view returns (bool)
```

Returns boolean flag indicating whether given address is a whitelisted oracle contract



#### Parameters

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | Boolean flag indicating whether given address is a whitelisted oracle contract |

### isWhitelistedToken

```solidity
function isWhitelistedToken(address) external view returns (bool)
```

Returns boolean flag indicating whether given address is a whitelisted token



#### Parameters

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | Boolean flag indicating whether given address is a whitelisted token |

### lenderVaultFactory

```solidity
function lenderVaultFactory() external view returns (address)
```

Returns the address of the vault factory




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | Address of the vault factory contract |

### owner

```solidity
function owner() external view returns (address)
```






#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

### proposeNewOwner

```solidity
function proposeNewOwner(address _newOwnerProposal) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| _newOwnerProposal | address | undefined |

### quoteHandler

```solidity
function quoteHandler() external view returns (address)
```

Returns the address of the quote handler




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | Address of the quote handler contract |

### registeredVaults

```solidity
function registeredVaults() external view returns (address[])
```

Returns an array of registered vault addresses




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address[] | The array of registered vault addresses |

### toggleCallbackAddr

```solidity
function toggleCallbackAddr(address addr, bool whitelistStatus) external nonpayable
```

toggles whitelist status of callback

*can only be called by registry owner*

#### Parameters

| Name | Type | Description |
|---|---|---|
| addr | address | address of callback |
| whitelistStatus | bool | true if whitelisted, else false to delist |

### toggleCompartmentImpl

```solidity
function toggleCompartmentImpl(address addr, bool whitelistStatus) external nonpayable
```

toggles whitelist status of compartment

*can only be called by registry owner*

#### Parameters

| Name | Type | Description |
|---|---|---|
| addr | address | address of compartment |
| whitelistStatus | bool | true if whitelisted, else false to delist |

### toggleOracle

```solidity
function toggleOracle(address addr, bool whitelistStatus) external nonpayable
```

toggles whitelist status of oracle

*can only be called by registry owner*

#### Parameters

| Name | Type | Description |
|---|---|---|
| addr | address | address of oracle |
| whitelistStatus | bool | true if whitelisted, else false to delist |

### toggleTokens

```solidity
function toggleTokens(address[] tokens, bool whitelistStatus) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| tokens | address[] | undefined |
| whitelistStatus | bool | undefined |



## Events

### AddedSigners

```solidity
event AddedSigners(address[] _signers)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| _signers  | address[] | undefined |

### Borrow

```solidity
event Borrow(address indexed vaultAddr, address indexed borrower, DataTypes.Loan loan, uint256 upfrontFee, uint256 loanId, address callbackAddr, bytes callbackData)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| vaultAddr `indexed` | address | undefined |
| borrower `indexed` | address | undefined |
| loan  | DataTypes.Loan | undefined |
| upfrontFee  | uint256 | undefined |
| loanId  | uint256 | undefined |
| callbackAddr  | address | undefined |
| callbackData  | bytes | undefined |

### ClaimedOwnership

```solidity
event ClaimedOwnership(address indexed owner, address oldOwner)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| owner `indexed` | address | undefined |
| oldOwner  | address | undefined |

### CollateralUnlocked

```solidity
event CollateralUnlocked(address indexed vaultOwner, address indexed collToken, uint256[] loanIds, bool autoWithdraw)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| vaultOwner `indexed` | address | undefined |
| collToken `indexed` | address | undefined |
| loanIds  | uint256[] | undefined |
| autoWithdraw  | bool | undefined |

### MinNumberOfSignersSet

```solidity
event MinNumberOfSignersSet(uint256 numSigners)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| numSigners  | uint256 | undefined |

### NewOwnerProposed

```solidity
event NewOwnerProposed(address indexed owner, address newOwner)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| owner `indexed` | address | undefined |
| newOwner  | address | undefined |

### NewProtocolFee

```solidity
event NewProtocolFee(uint256 newFee)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| newFee  | uint256 | undefined |

### NewVaultCreated

```solidity
event NewVaultCreated(address indexed newLenderVaultAddr, address vaultOwner)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| newLenderVaultAddr `indexed` | address | undefined |
| vaultOwner  | address | undefined |

### OffChainQuoteInvalidated

```solidity
event OffChainQuoteInvalidated(address lenderVault, bytes32 offChainQuoteHash)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault  | address | undefined |
| offChainQuoteHash  | bytes32 | undefined |

### OnChainQuoteAdded

```solidity
event OnChainQuoteAdded(address lenderVault, DataTypes.OnChainQuote onChainQuote, bytes32 onChainQuoteHash)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault  | address | undefined |
| onChainQuote  | DataTypes.OnChainQuote | undefined |
| onChainQuoteHash  | bytes32 | undefined |

### OnChainQuoteDeleted

```solidity
event OnChainQuoteDeleted(address lenderVault, bytes32 onChainQuoteHash)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault  | address | undefined |
| onChainQuoteHash  | bytes32 | undefined |

### OnChainQuoteInvalidated

```solidity
event OnChainQuoteInvalidated(address lenderVault, bytes32 onChainQuoteHash)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault  | address | undefined |
| onChainQuoteHash  | bytes32 | undefined |

### RemovedSigner

```solidity
event RemovedSigner(address signerRemoved, uint256 signerIdx, address signerMovedFromEnd)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| signerRemoved  | address | undefined |
| signerIdx  | uint256 | undefined |
| signerMovedFromEnd  | address | undefined |

### Repay

```solidity
event Repay(address indexed vaultAddr, uint256 indexed loanId, uint256 repayAmount)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| vaultAddr `indexed` | address | undefined |
| loanId `indexed` | uint256 | undefined |
| repayAmount  | uint256 | undefined |

### WhitelistAddressToggled

```solidity
event WhitelistAddressToggled(address[] indexed addressToggled, bool whitelistStatus, enum IEvents.EventToggleType toggleType)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| addressToggled `indexed` | address[] | undefined |
| whitelistStatus  | bool | undefined |
| toggleType  | enum IEvents.EventToggleType | undefined |



## Errors

### AlreadyInitialized

```solidity
error AlreadyInitialized()
```






### DuplicateAddresses

```solidity
error DuplicateAddresses()
```






### InvalidAddress

```solidity
error InvalidAddress()
```






### InvalidSender

```solidity
error InvalidSender()
```






### Uninitialized

```solidity
error Uninitialized()
```







