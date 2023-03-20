# ILenderVaultImpl









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

### initialize

```solidity
function initialize(address vaultOwner, address addressRegistry) external nonpayable
```

function to initialize lender vault

*factory creates clone and then initializes the vault*

#### Parameters

| Name | Type | Description |
|---|---|---|
| vaultOwner | address | address of vault owner |
| addressRegistry | address | registry address |

### isSigner

```solidity
function isSigner(address signer) external view returns (bool)
```

function returns if address is a signer



#### Parameters

| Name | Type | Description |
|---|---|---|
| signer | address | undefined |

#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | bool | true, if a signer, else false |

### loan

```solidity
function loan(uint256 index) external view returns (struct DataTypes.Loan loan)
```

function to retrieve loan from loans array in vault

*this function reverts on invalid index*

#### Parameters

| Name | Type | Description |
|---|---|---|
| index | uint256 | index of loan |

#### Returns

| Name | Type | Description |
|---|---|---|
| loan | DataTypes.Loan | loan stored at that index in vault |

### lockedAmounts

```solidity
function lockedAmounts(address token) external view returns (uint256)
```

function returns current locked amounts of given token



#### Parameters

| Name | Type | Description |
|---|---|---|
| token | address | address of the token |

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

function to return owner address




#### Returns

| Name | Type | Description |
|---|---|---|
| _0 | address | owner address |

### processQuote

```solidity
function processQuote(address borrower, DataTypes.BorrowTransferInstructions borrowInstructions, DataTypes.GeneralQuoteInfo generalQuoteInfo, DataTypes.QuoteTuple quoteTuple) external nonpayable returns (struct DataTypes.Loan loan, uint256 loanId, uint256 upfrontFee, address collReceiver)
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
| loan | DataTypes.Loan | undefined |
| loanId | uint256 | undefined |
| upfrontFee | uint256 | undefined |
| collReceiver | address | undefined |

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
function signers(uint256 index) external view returns (address)
```

function returns signer at given index



#### Parameters

| Name | Type | Description |
|---|---|---|
| index | uint256 | of the signers array |

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
function updateLoanInfo(DataTypes.Loan loan, uint128 repayAmount, uint256 loanId, uint256 collAmount) external nonpayable
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| loan | DataTypes.Loan | undefined |
| repayAmount | uint128 | undefined |
| loanId | uint256 | undefined |
| collAmount | uint256 | undefined |

### validateRepayInfo

```solidity
function validateRepayInfo(address borrower, DataTypes.Loan loan, DataTypes.LoanRepayInstructions loanRepayInstructions) external view
```





#### Parameters

| Name | Type | Description |
|---|---|---|
| borrower | address | undefined |
| loan | DataTypes.Loan | undefined |
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




