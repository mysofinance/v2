# MYSO
This repository contains the smart contracts source code for the MYSO V1.2 protocol. The repository uses Hardhat as development environment for compilation, testing and deployment tasks.

## What is MYSO?
MYSO is a protocol for Zero-Liquidation Loans, where users can borrow or lend with one another on a peer-to-pool basis. A Zero-Liquidation Loan is a crypto-collateralized loan with a fixed tenor (e.g., 30 days) in which borrowers aren't exposed to liquidation risk. 

After pledging some collateral users can take out a loan and later reclaim their collateral by repaying prior to expiry. Liquidity Providers (LPs) bear the risk that during the loan lifetime the collateral can be worth less the loan amount, in which case borrowers might not repay and LPs will be left with the collateral. However, LPs earn a yield in exchange for bearing this risk (similar to a covered call strategy).

## Quick Start
```
npm i
npx hardhat test
```

## Contract Files
```
contracts
 ┣ peer-to-peer
 ┃ ┣ callbacks
 ┃ ┃ ┣ BalancerV2Looping.sol
 ┃ ┃ ┗ UniV3Looping.sol
 ┃ ┣ compartments
 ┃ ┃ ┣ staking
 ┃ ┃ ┃ ┣ AaveStakingCompartment.sol
 ┃ ┃ ┃ ┣ CurveLPStakingCompartment.sol
 ┃ ┃ ┃ ┗ GLPStakingCompartment.sol
 ┃ ┃ ┣ voting
 ┃ ┃ ┃ ┗ VoteCompartment.sol
 ┃ ┃ ┗ BaseCompartment.sol
 ┃ ┣ interfaces
 ┃ ┃ ┣ compartments
 ┃ ┃ ┃ ┣ staking
 ┃ ┃ ┃ ┃ ┗ IStakingHelper.sol
 ┃ ┃ ┃ ┗ IBaseCompartment.sol
 ┃ ┃ ┣ oracles
 ┃ ┃ ┃ ┣ chainlink
 ┃ ┃ ┃ ┃ ┗ AggregatorV3Interface.sol
 ┃ ┃ ┃ ┣ IOlympus.sol
 ┃ ┃ ┃ ┗ IUniV2.sol
 ┃ ┃ ┣ IAddressRegistry.sol
 ┃ ┃ ┣ IBorrowerGateway.sol
 ┃ ┃ ┣ IEvents.sol
 ┃ ┃ ┣ ILenderVaultFactory.sol
 ┃ ┃ ┣ ILenderVaultImpl.sol
 ┃ ┃ ┣ IOracle.sol
 ┃ ┃ ┣ IQuoteHandler.sol
 ┃ ┃ ┗ IVaultCallback.sol
 ┃ ┣ oracles
 ┃ ┃ ┣ chainlink
 ┃ ┃ ┃ ┣ ChainlinkBasic.sol
 ┃ ┃ ┃ ┣ OlympusOracle.sol
 ┃ ┃ ┃ ┗ UniV2Chainlink.sol
 ┃ ┃ ┗ BaseOracle.sol
 ┃ ┣ AddressRegistry.sol
 ┃ ┣ BorrowerGateway.sol
 ┃ ┣ DataTypes.sol
 ┃ ┣ LenderVaultFactory.sol
 ┃ ┣ LenderVaultImpl.sol
 ┃ ┗ QuoteHandler.sol
 ┣ peer-to-pool
 ┃ ┣ interfaces
 ┃ ┃ ┣ IEvents.sol
 ┃ ┃ ┣ IFundingPool.sol
 ┃ ┃ ┣ ILoanProposalFactory.sol
 ┃ ┃ ┗ ILoanProposalImpl.sol
 ┃ ┣ DataTypes.sol
 ┃ ┣ FundingPool.sol
 ┃ ┣ LoanProposalFactory.sol
 ┃ ┗ LoanProposalImpl.sol
 ┣ test
 ┃ ┣ IPAXG.sol
 ┃ ┣ IUSDC.sol
 ┃ ┣ IWETH.sol
 ┃ ┣ MyERC20.sol
 ┃ ┗ MyMaliciousERC20.sol
 ┣ Constants.sol
 ┣ Errors.sol
 ┗ Ownable.sol
```

## Libraries & Dependencies

The following OpenZeppelin 4.8.0 libraries are used:
* IERC20Metadata
* SafeERC20
* Initializable
* Clones

The following DeFi integrations are incorporated:
* Callbacks/Looping -> Uni v3 and Balancer
* Compartments/Collateral Management -> Curve, GLP, Aave aTokens
* Oracle -> Chainlink, Olympus Ohm

## Documentation
Documentation of the v1 repo can be found in [docs](/docs) and in the [whitepaper](https://figshare.com/articles/preprint/MYSO_v1_Core_A_Trust-Minimized_Protocol_for_Zero-Liquidation_Loans/21581328).

Todo:v1.2 doc links

## Test Files
```
test
 ┣ peer-to-peer
 ┃ ┣ helpers
 ┃ ┃ ┣ abi.ts
 ┃ ┃ ┣ misc.ts
 ┃ ┃ ┗ uniV3.ts
 ┃ ┣ arbitrum-forked-tests.ts
 ┃ ┣ local-tests.ts
 ┃ ┣ mainnet-forked-looping-tests.ts
 ┃ ┗ mainnet-forked-tests.ts
 ┗ peer-to-pool
 ┃ ┣ helpers
 ┃ ┃ ┗ misc.ts
 ┃ ┗ local-tests.ts
```

### Test Coverage

