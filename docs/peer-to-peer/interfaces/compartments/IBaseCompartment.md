# IBaseCompartment









## Methods

### initialize

```solidity
function initialize(address vaultAddr, uint256 loanId) external nonpayable
```

function to initialize collateral compartment

*factory creates clone and then initializes implementation contract*

#### Parameters

| Name | Type | Description |
|---|---|---|
| vaultAddr | address | address of vault |
| loanId | uint256 | index of the loan |

### transferCollFromCompartment

```solidity
function transferCollFromCompartment(uint256 repayAmount, uint256 repayAmountLeft, address borrowerAddr, address collTokenAddr, address callbackAddr) external nonpayable
```

function to transfer some amount of collateral to borrower on repay

*this function can only be called by vault and tranfers proportional amount of compartment collTokenBalance to borrower address. This needs use a proportion and not the amount to account for possible changes due to rewards accruing*

#### Parameters

| Name | Type | Description |
|---|---|---|
| repayAmount | uint256 | amount of loan token being sent to vault |
| repayAmountLeft | uint256 | amount of loan token still outstanding |
| borrowerAddr | address | address of borrower receiving transfer |
| collTokenAddr | address | address of collateral token being transferred |
| callbackAddr | address | address to send collateral to instead of borrower if using callback |

### unlockCollToVault

```solidity
function unlockCollToVault(address collTokenAddr) external nonpayable
```

function to unlock all collateral left in compartment

*this function can only be called by vault and returns all collateral to vault*

#### Parameters

| Name | Type | Description |
|---|---|---|
| collTokenAddr | address | pass in collToken addr to avoid callback reads gas cost |



