# QuoteHandler









## Methods

### addOnChainQuote

```solidity
function addOnChainQuote(address lenderVault, DataTypes.OnChainQuote onChainQuote) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault | address | undefined |
| onChainQuote | DataTypes.OnChainQuote | undefined |

### addressRegistry

```solidity
function addressRegistry() external view returns (address)
```

function to return address of registry




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | registry address |

### checkAndRegisterOffChainQuote

```solidity
function checkAndRegisterOffChainQuote(address borrower, address lenderVault, DataTypes.OffChainQuote offChainQuote, DataTypes.QuoteTuple quoteTuple, bytes32[] proof) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| borrower | address | undefined |
| lenderVault | address | undefined |
| offChainQuote | DataTypes.OffChainQuote | undefined |
| quoteTuple | DataTypes.QuoteTuple | undefined |
| proof | bytes32[] | undefined |

### checkAndRegisterOnChainQuote

```solidity
function checkAndRegisterOnChainQuote(address borrower, address lenderVault, DataTypes.OnChainQuote onChainQuote) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| borrower | address | undefined |
| lenderVault | address | undefined |
| onChainQuote | DataTypes.OnChainQuote | undefined |

### deleteOnChainQuote

```solidity
function deleteOnChainQuote(address lenderVault, DataTypes.OnChainQuote onChainQuote) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault | address | undefined |
| onChainQuote | DataTypes.OnChainQuote | undefined |

### incrementOffChainQuoteNonce

```solidity
function incrementOffChainQuoteNonce(address lenderVault) external nonpayable
```

function increments the nonce for a vault

*function can only be called by vault owner incrementing the nonce can bulk invalidate any off chain quotes with that nonce in one txn*

#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault | address | address of the vault |

### invalidateOffChainQuote

```solidity
function invalidateOffChainQuote(address lenderVault, bytes32 offChainQuoteHash) external nonpayable
```

function invalidates off chain quote

*function can only be called by vault owner this function invalidates one specific quote*

#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault | address | address of the vault |
| offChainQuoteHash | bytes32 | hash of the off chain quote to be invalidated |

### isOnChainQuote

```solidity
function isOnChainQuote(address, bytes32) external view returns (bool)
```

function returns if hash is for an on chain quote



#### Parameters

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |
| _1 | bytes32 | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | true if hash belongs to a valid on-chain quote, else false |

### offChainQuoteIsInvalidated

```solidity
function offChainQuoteIsInvalidated(address, bytes32) external view returns (bool)
```

function returns if offchain quote hash is invalidated



#### Parameters

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |
| _1 | bytes32 | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | true if invalidated, else false |

### offChainQuoteNonce

```solidity
function offChainQuoteNonce(address) external view returns (uint256)
```

function to return the current nonce for offchain quotes



#### Parameters

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | uint256 | current value of nonce |

### updateOnChainQuote

```solidity
function updateOnChainQuote(address lenderVault, DataTypes.OnChainQuote oldOnChainQuote, DataTypes.OnChainQuote newOnChainQuote) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault | address | undefined |
| oldOnChainQuote | DataTypes.OnChainQuote | undefined |
| newOnChainQuote | DataTypes.OnChainQuote | undefined |



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

### InvalidBorrower

```solidity
error InvalidBorrower()
```






### InvalidOffChainMerkleProof

```solidity
error InvalidOffChainMerkleProof()
```






### InvalidOffChainSignature

```solidity
error InvalidOffChainSignature()
```






### InvalidQuote

```solidity
error InvalidQuote()
```






### InvalidSender

```solidity
error InvalidSender()
```






### NonWhitelistedToken

```solidity
error NonWhitelistedToken()
```






### OffChainQuoteHasBeenInvalidated

```solidity
error OffChainQuoteHasBeenInvalidated()
```






### OnChainQuoteAlreadyAdded

```solidity
error OnChainQuoteAlreadyAdded()
```






### UnknownOnChainQuote

```solidity
error UnknownOnChainQuote()
```






### UnregisteredVault

```solidity
error UnregisteredVault()
```







