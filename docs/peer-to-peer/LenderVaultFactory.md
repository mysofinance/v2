# LenderVaultFactory









## Methods

### addressRegistry

```solidity
function addressRegistry() external view returns (address)
```

function returns address registry




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | address of registry |

### createVault

```solidity
function createVault() external nonpayable returns (address newLenderVaultAddr)
```

function creates new lender vaults




#### Returns

| Name | Type | Description |
|---|---|---|
| newLenderVaultAddr | address | address of created vault |

### lenderVaultImpl

```solidity
function lenderVaultImpl() external view returns (address)
```

function returns address of lender vault implementation contract




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | address of lender vault implementation |



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



