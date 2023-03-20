# BorrowerGateway









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

### borrowWithOffChainQuote

```solidity
function borrowWithOffChainQuote(address lenderVault, DataTypes.BorrowTransferInstructions borrowInstructions, DataTypes.OffChainQuote offChainQuote, DataTypes.QuoteTuple quoteTuple, bytes32[] proof) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault | address | undefined |
| borrowInstructions | DataTypes.BorrowTransferInstructions | undefined |
| offChainQuote | DataTypes.OffChainQuote | undefined |
| quoteTuple | DataTypes.QuoteTuple | undefined |
| proof | bytes32[] | undefined |

### borrowWithOnChainQuote

```solidity
function borrowWithOnChainQuote(address lenderVault, DataTypes.BorrowTransferInstructions borrowInstructions, DataTypes.OnChainQuote onChainQuote, uint256 quoteTupleIdx) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| lenderVault | address | undefined |
| borrowInstructions | DataTypes.BorrowTransferInstructions | undefined |
| onChainQuote | DataTypes.OnChainQuote | undefined |
| quoteTupleIdx | uint256 | undefined |

### protocolFee

```solidity
function protocolFee() external view returns (uint256)
```

function returns protocol fee




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | uint256 | protocol fee in BASE |

### repay

```solidity
function repay(DataTypes.LoanRepayInstructions loanRepayInstructions, address vaultAddr, address callbackAddr, bytes callbackData) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| loanRepayInstructions | DataTypes.LoanRepayInstructions | undefined |
| vaultAddr | address | undefined |
| callbackAddr | address | undefined |
| callbackData | bytes | undefined |

### setNewProtocolFee

```solidity
function setNewProtocolFee(uint256 _newFee) external nonpayable
```

function which allows owner to set new protocol fee

*protocolFee is in units of BASE constant (10**18) and annualized*

#### Parameters

| Name | Type | Description |
|---|---|---|
| _newFee | uint256 | new fee in BASE |



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

### DeadlinePassed

```solidity
error DeadlinePassed()
```






### InsufficientSendAmount

```solidity
error InsufficientSendAmount()
```






### InvalidFee

```solidity
error InvalidFee()
```






### InvalidSendAmount

```solidity
error InvalidSendAmount()
```






### InvalidSender

```solidity
error InvalidSender()
```






### NonWhitelistedCallback

```solidity
error NonWhitelistedCallback()
```






### UnregisteredVault

```solidity
error UnregisteredVault()
```







