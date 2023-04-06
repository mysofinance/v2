# LenderVaultImpl









## Methods

### addSigners

```solidity
function addSigners(address[] _signers) external nonpayable
```

function to add a signer

*this function only can be called by vault owner*

#### Parameters

| Name | Type | Description |
|---|---|---|
| _signers | address[] | array of signers to add |

### addressRegistry

```solidity
function addressRegistry() external view returns (address)
```

function to return address of registry




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | registry address |

### claimOwnership

```solidity
function claimOwnership() external nonpayable
```






### getTokenBalancesAndLockedAmounts

```solidity
function getTokenBalancesAndLockedAmounts(address[] tokens) external view returns (uint256[] balances, uint256[] _lockedAmounts)
```

function to return unlocked token balances



#### Parameters

| Name | Type | Description |
|---|---|---|
| tokens | address[] | array of token addresses |

#### Returns

| Name | Type | Description |
|---|---|---|
| balances | uint256[] | the vault balances of the token addresses |
| _lockedAmounts | uint256[] | the vault locked amounts of the token addresses |

### initialize

```solidity
function initialize(address _vaultOwner, address _addressRegistry) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| _vaultOwner | address | undefined |
| _addressRegistry | address | undefined |

### isSigner

```solidity
function isSigner(address) external view returns (bool)
```

function returns if address is a signer



#### Parameters

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | true, if a signer, else false |

### loan

```solidity
function loan(uint256 loanId) external view returns (struct DataTypes.Loan _loan)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| loanId | uint256 | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _loan | DataTypes.Loan | undefined |

### lockedAmounts

```solidity
function lockedAmounts(address) external view returns (uint256)
```

function returns current locked amounts of given token



#### Parameters

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | uint256 | amount of token locked |

### minNumOfSigners

```solidity
function minNumOfSigners() external view returns (uint256)
```

function returns minimum number of signers




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | uint256 | minimum number of signers |

### owner

```solidity
function owner() external view returns (address)
```






#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | undefined |

### processQuote

```solidity
function processQuote(address borrower, DataTypes.BorrowTransferInstructions borrowInstructions, DataTypes.GeneralQuoteInfo generalQuoteInfo, DataTypes.QuoteTuple quoteTuple) external nonpayable returns (struct DataTypes.Loan _loan, uint256 loanId, uint256 upfrontFee, address collReceiver)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| borrower | address | undefined |
| borrowInstructions | DataTypes.BorrowTransferInstructions | undefined |
| generalQuoteInfo | DataTypes.GeneralQuoteInfo | undefined |
| quoteTuple | DataTypes.QuoteTuple | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _loan | DataTypes.Loan | undefined |
| loanId | uint256 | undefined |
| upfrontFee | uint256 | undefined |
| collReceiver | address | undefined |

### proposeNewOwner

```solidity
function proposeNewOwner(address _newOwnerProposal) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| _newOwnerProposal | address | undefined |

### removeSigner

```solidity
function removeSigner(address signer, uint256 signerIdx) external nonpayable
```

function to remove a signer

*this function only can be called by vault owner*

#### Parameters

| Name | Type | Description |
|---|---|---|
| signer | address | address of signer to be removed |
| signerIdx | uint256 | index of the signers array at which signer resides |

### setMinNumOfSigners

```solidity
function setMinNumOfSigners(uint256 _minNumOfSigners) external nonpayable
```

function to set minimum number of signers required for an offchain quote

*this function allows a multi-sig quorum to sign a quote offchain*

#### Parameters

| Name | Type | Description |
|---|---|---|
| _minNumOfSigners | uint256 | minimum number of signatures borrower needs to provide |

### signers

```solidity
function signers(uint256) external view returns (address)
```

function returns signer at given index



#### Parameters

| Name | Type | Description |
|---|---|---|
| _0 | uint256 | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | signer address |

### transferCollFromCompartment

```solidity
function transferCollFromCompartment(uint256 repayAmount, uint256 repayAmountLeft, address borrowerAddr, address collTokenAddr, address callbackAddr, address collTokenCompartmentAddr) external nonpayable
```

function to transfer token from a compartment

*only borrow gateway can call this function, if callbackAddr, then the collateral will be transferred to the callback address*

#### Parameters

| Name | Type | Description |
|---|---|---|
| repayAmount | uint256 | amount of loan token that was repaid |
| repayAmountLeft | uint256 | amount of loan still outstanding |
| borrowerAddr | address | address of the borrower |
| collTokenAddr | address | address of the coll token to transfer to compartment |
| callbackAddr | address | address of callback |
| collTokenCompartmentAddr | address | address of the coll token compartment |

### transferTo

```solidity
function transferTo(address token, address recipient, uint256 amount) external nonpayable
```

function to transfer token from vault

*only borrow gateway can call this function*

#### Parameters

| Name | Type | Description |
|---|---|---|
| token | address | address of the token to transfer |
| recipient | address | address which receives the tokens |
| amount | uint256 | amount of token to transfer |

### unlockCollateral

```solidity
function unlockCollateral(address collToken, uint256[] _loanIds, bool autoWithdraw) external nonpayable
```

function to unlock defaulted collateral

*only loans with same collateral token can be unlocked in one call function will revert if mismatch in coll token to a loan.collToken. note: a vault owner may not want to autowithdraw collateral if he also uses the token as loans*

#### Parameters

| Name | Type | Description |
|---|---|---|
| collToken | address | address of the collateral token |
| _loanIds | uint256[] | array of indices of the loans to unlock |
| autoWithdraw | bool | if true, then withdraw collateral as well |

### updateLoanInfo

```solidity
function updateLoanInfo(DataTypes.Loan _loan, uint128 repayAmount, uint256 loanId, uint256 collAmount) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| _loan | DataTypes.Loan | undefined |
| repayAmount | uint128 | undefined |
| loanId | uint256 | undefined |
| collAmount | uint256 | undefined |

### validateRepayInfo

```solidity
function validateRepayInfo(address borrower, DataTypes.Loan _loan, DataTypes.LoanRepayInstructions loanRepayInstructions) external view
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| borrower | address | undefined |
| _loan | DataTypes.Loan | undefined |
| loanRepayInstructions | DataTypes.LoanRepayInstructions | undefined |

### withdraw

```solidity
function withdraw(address token, uint256 amount) external nonpayable
```

function to withdraw a token from a vault

*only vault owner can withdraw*

#### Parameters

| Name | Type | Description |
|---|---|---|
| token | address | address of the token to withdraw |
| amount | uint256 | amount of token to withdraw |

### withdrawEntered

```solidity
function withdrawEntered() external view returns (bool)
```

function returns if withdraw mutex is activated




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | true, if withdraw already called, else false |



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

### Initialized

```solidity
event Initialized(uint8 version)
```



*Triggered when the contract has been initialized or reinitialized.*

#### Parameters

| Name | Type | Description |
|---|---|---|
| version  | uint8 | undefined |

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

### QuoteProcessed

```solidity
event QuoteProcessed(address borrower, DataTypes.Loan loan, uint256 loanId, address collReceiver)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| borrower  | address | undefined |
| loan  | DataTypes.Loan | undefined |
| loanId  | uint256 | undefined |
| collReceiver  | address | undefined |

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

### Withdraw

```solidity
event Withdraw(address indexed tokenAddr, uint256 withdrawAmount)
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| tokenAddr `indexed` | address | undefined |
| withdrawAmount  | uint256 | undefined |



## Errors

### AlreadySigner

```solidity
error AlreadySigner()
```






### ExpiresBeforeRepayAllowed

```solidity
error ExpiresBeforeRepayAllowed()
```






### InconsistentUnlockTokenAddresses

```solidity
error InconsistentUnlockTokenAddresses()
```






### InsufficientSendAmount

```solidity
error InsufficientSendAmount()
```






### InsufficientVaultFunds

```solidity
error InsufficientVaultFunds()
```






### InvalidAddress

```solidity
error InvalidAddress()
```






### InvalidArrayIndex

```solidity
error InvalidArrayIndex()
```






### InvalidArrayLength

```solidity
error InvalidArrayLength()
```






### InvalidBorrower

```solidity
error InvalidBorrower()
```






### InvalidCollUnlock

```solidity
error InvalidCollUnlock()
```






### InvalidNewMinNumOfSigners

```solidity
error InvalidNewMinNumOfSigners()
```






### InvalidRepayAmount

```solidity
error InvalidRepayAmount()
```






### InvalidSendAmount

```solidity
error InvalidSendAmount()
```






### InvalidSender

```solidity
error InvalidSender()
```






### InvalidSignerRemoveInfo

```solidity
error InvalidSignerRemoveInfo()
```






### InvalidWithdrawAmount

```solidity
error InvalidWithdrawAmount()
```






### LTVHigherThanMax

```solidity
error LTVHigherThanMax()
```






### NegativeRepaymentAmount

```solidity
error NegativeRepaymentAmount()
```






### NonWhitelistedCompartment

```solidity
error NonWhitelistedCompartment()
```






### NonWhitelistedOracle

```solidity
error NonWhitelistedOracle()
```






### OutsideValidRepayWindow

```solidity
error OutsideValidRepayWindow()
```






### OverflowUint128

```solidity
error OverflowUint128()
```






### TooSmallLoanAmount

```solidity
error TooSmallLoanAmount()
```






### UnregisteredGateway

```solidity
error UnregisteredGateway()
```






### WithdrawEntered

```solidity
error WithdrawEntered()
```







