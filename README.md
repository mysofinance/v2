# MYSO
This repository contains the smart contracts source code for the MYSO v2 protocol. The repository uses Hardhat as development environment for compilation, testing and deployment tasks.

## What is MYSO?
The MYSO v2 protocol allows borrowing and lending based on so called Zero-Liquidation Loans. A Zero-Liquidation Loan is a crypto-collateralized loan in which the borrower pledges some collateral token and borrows some loan token against it. However, in contrast to conventional DeFi loans, borrowers aren't exposed to liquidation risk, meaning that their collateral is never at risk of being forcefully auctioned off to liquidators in case the collateral price drops below a liquidation threshold (even if the price rebounds afterwards again). Zero-Liquidation Loans have a fixed tenor (e.g., 90 days) during which borrowers have the right (but not the obligation) to reclaim their collateral by repaying a pre-defined repayment amount. If borrowers don't repay prior to expiry they forfeit their ability to reclaim their collateral, in which case the collateral gets redistributed to lenders. Lenders of Zero-Liquidation Loans -by design- bear default risk, however, can earn yield for this (the payoff is similar to a covered call strategy).

### Use Cases
The protocol supports two different models, each targeted at different use cases and user groups:
* Peer-to-peer model: in this model, the target borrowers are smaller to medium sized borrowers who are looking for (I) loan offers for niche collateral assets that currently aren’t supported on Aave etc. and/or (ii) loan alternatives for bluechips (e.g. ETH etc.) but without liquidation risk. Target lenders are medium sized lenders (e.g., like the MYSO team, or lending clubs/collectives) as well as larger sized lenders (e.g., whales or institutional lenders) who are looking for higher yields than on Aave and are interested in capitalizing on underserved borrowing demand with less (or no) competition and correspondingly higher extractable risk premiums.
* Peer-to-pool model: in this model, the target borrowers are DAO treasuries, and the target lenders are the MYSO community, and/or other DeFi communities. DAO treasuries can borrow stables against their native token (which makes up most of DAO treasuries), using ZLLs to diversify from their native token holdings and utilize the borrowed stables to (i) earn yield, (ii) cover short/mid term liquidity needs/expenses, (iii) bootstrap liquidity in own DeFi offerings –if applicable. In the peer-to-pool mode, ZLLs also come with a convertible feature which allows the DAO treasury to lower interest rate costs by giving up upside to borrowers and, for borrowers provides upside participation. In this model, borrowers and lenders are brought together through “arrangers”, who can propose and pitch loan structures to DAO treasuries, and to which lenders –who previously deposited funds into a pool– can subscribe to.

## Quick Start
```
npm i
npx hardhat test
```

## Contract Files
```
contracts/
┣ interfaces/
┃ ┗ IMysoTokenManager.sol
┣ peer-to-peer/
┃ ┣ callbacks/
┃ ┃ ┣ BalancerV2Looping.sol
┃ ┃ ┗ UniV3Looping.sol
┃ ┣ compartments/
┃ ┃ ┣ staking/
┃ ┃ ┃ ┣ AaveStakingCompartment.sol
┃ ┃ ┃ ┣ CurveLPStakingCompartment.sol
┃ ┃ ┃ ┗ GLPStakingCompartment.sol
┃ ┃ ┣ voting/
┃ ┃ ┃ ┗ VoteCompartment.sol
┃ ┃ ┗ BaseCompartment.sol
┃ ┣ interfaces/
┃ ┃ ┣ callbacks/
┃ ┃ ┃ ┣ BalancerDataTypes.sol
┃ ┃ ┃ ┣ IBalancerAsset.sol
┃ ┃ ┃ ┣ IBalancerVault.sol
┃ ┃ ┃ ┗ ISwapRouter.sol
┃ ┃ ┣ compartments/
┃ ┃ ┃ ┣ staking/
┃ ┃ ┃ ┃ ┗ IStakingHelper.sol
┃ ┃ ┃ ┗ IBaseCompartment.sol
┃ ┃ ┣ oracles/
┃ ┃ ┃ ┣ chainlink/
┃ ┃ ┃ ┃ ┗ AggregatorV3Interface.sol
┃ ┃ ┃ ┣ IOlympus.sol
┃ ┃ ┃ ┗ IUniV2.sol
┃ ┃ ┣ wrappers/
┃ ┃ ┃ ┣ ERC20/
┃ ┃ ┃ ┃ ┣ IERC20Wrapper.sol
┃ ┃ ┃ ┃ ┗ IWrappedERC20Impl.sol
┃ ┃ ┃ ┗ ERC721/
┃ ┃ ┃   ┣ IERC721Wrapper.sol
┃ ┃ ┃   ┗ IWrappedERC721Impl.sol
┃ ┃ ┣ IAddressRegistry.sol
┃ ┃ ┣ IBorrowerGateway.sol
┃ ┃ ┣ ILenderVaultFactory.sol
┃ ┃ ┣ ILenderVaultImpl.sol
┃ ┃ ┣ IOracle.sol
┃ ┃ ┣ IQuoteHandler.sol
┃ ┃ ┗ IVaultCallback.sol
┃ ┣ oracles/
┃ ┃ ┗ chainlink/
┃ ┃   ┣ ChainlinkBasic.sol
┃ ┃   ┣ ChainlinkBasicWithWbtc.sol
┃ ┃   ┣ OlympusOracle.sol
┃ ┃   ┗ UniV2Chainlink.sol
┃ ┣ wrappers/
┃ ┃ ┣ ERC20/
┃ ┃ ┃ ┣ ERC20Wrapper.sol
┃ ┃ ┃ ┗ WrappedERC20Impl.sol
┃ ┃ ┗ ERC721/
┃ ┃   ┣ ERC721Wrapper.sol
┃ ┃   ┗ WrappedERC721Impl.sol
┃ ┣ AddressRegistry.sol
┃ ┣ BorrowerGateway.sol
┃ ┣ DataTypesPeerToPeer.sol
┃ ┣ LenderVaultFactory.sol
┃ ┣ LenderVaultImpl.sol
┃ ┗ QuoteHandler.sol
┣ peer-to-pool/
┃ ┣ interfaces/
┃ ┃ ┣ IFactory.sol
┃ ┃ ┣ IFundingPoolImpl.sol
┃ ┃ ┗ ILoanProposalImpl.sol
┃ ┣ DataTypesPeerToPool.sol
┃ ┣ Factory.sol
┃ ┣ FundingPoolImpl.sol
┃ ┗ LoanProposalImpl.sol
┣ test/
┃ ┣ IPAXG.sol
┃ ┣ IUSDC.sol
┃ ┣ IWETH.sol
┃ ┣ MyERC20.sol
┃ ┣ MyERC721.sol
┃ ┣ MyMaliciousCallback1.sol
┃ ┣ MyMaliciousCallback2.sol
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
* Math

The following DeFi integrations are incorporated:
* Callbacks/Looping -> Uni v3 and Balancer
* Compartments/Collateral Management -> Curve, GLP, Aave aTokens
* Oracle -> Chainlink, Olympus Ohm

## Test Files
```
test/
┣ peer-to-peer/
┃ ┣ helpers/
┃ ┃ ┣ abi.ts
┃ ┃ ┣ misc.ts
┃ ┃ ┗ uniV3.ts
┃ ┣ arbitrum-forked-tests.ts
┃ ┣ local-tests.ts
┃ ┗ mainnet-forked-tests.ts
┗ peer-to-pool/
  ┣ helpers/
┃ ┃ ┗ misc.ts
  ┗ local-tests.ts
```

### Test Coverage
```
---------------------------------------------------------|----------|----------|----------|----------|----------------|
File                                                     |  % Stmts | % Branch |  % Funcs |  % Lines |Uncovered Lines |
---------------------------------------------------------|----------|----------|----------|----------|----------------|
 contracts\                                              |      100 |      100 |      100 |      100 |                |
  Constants.sol                                          |      100 |      100 |      100 |      100 |                |
  Errors.sol                                             |      100 |      100 |      100 |      100 |                |
  Ownable.sol                                            |      100 |      100 |      100 |      100 |                |
 contracts\interfaces\                                   |      100 |      100 |      100 |      100 |                |
  IMysoTokenManager.sol                                  |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\                                 |    99.31 |    95.61 |      100 |    97.88 |                |
  AddressRegistry.sol                                    |      100 |    95.71 |      100 |    96.91 |       73,83,96 |
  BorrowerGateway.sol                                    |    98.08 |    84.09 |      100 |    94.67 |245,252,253,270 |
  DataTypesPeerToPeer.sol                                |      100 |      100 |      100 |      100 |                |
  LenderVaultFactory.sol                                 |    88.89 |       75 |      100 |    92.31 |             40 |
  LenderVaultImpl.sol                                    |      100 |    98.78 |      100 |    98.62 |        279,280 |
  QuoteHandler.sol                                       |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\callbacks\                       |      100 |      100 |      100 |      100 |                |
  BalancerV2Looping.sol                                  |      100 |      100 |      100 |      100 |                |
  UniV3Looping.sol                                       |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\compartments\                    |      100 |    91.67 |      100 |    94.44 |                |
  BaseCompartment.sol                                    |      100 |    91.67 |      100 |    94.44 |             27 |
 contracts\peer-to-peer\compartments\staking\            |      100 |    83.33 |      100 |    96.25 |                |
  AaveStakingCompartment.sol                             |      100 |      100 |      100 |      100 |                |
  CurveLPStakingCompartment.sol                          |      100 |    83.33 |      100 |    95.65 |    131,135,136 |
  GLPStakingCompartment.sol                              |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\compartments\voting\             |      100 |     87.5 |      100 |    94.44 |                |
  VoteCompartment.sol                                    |      100 |     87.5 |      100 |    94.44 |             37 |
 contracts\peer-to-peer\interfaces\                      |      100 |      100 |      100 |      100 |                |
  IAddressRegistry.sol                                   |      100 |      100 |      100 |      100 |                |
  IBorrowerGateway.sol                                   |      100 |      100 |      100 |      100 |                |
  ILenderVaultFactory.sol                                |      100 |      100 |      100 |      100 |                |
  ILenderVaultImpl.sol                                   |      100 |      100 |      100 |      100 |                |
  IOracle.sol                                            |      100 |      100 |      100 |      100 |                |
  IQuoteHandler.sol                                      |      100 |      100 |      100 |      100 |                |
  IVaultCallback.sol                                     |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\interfaces\callbacks\            |      100 |      100 |      100 |      100 |                |
  BalancerDataTypes.sol                                  |      100 |      100 |      100 |      100 |                |
  IBalancerAsset.sol                                     |      100 |      100 |      100 |      100 |                |
  IBalancerVault.sol                                     |      100 |      100 |      100 |      100 |                |
  ISwapRouter.sol                                        |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\interfaces\compartments\         |      100 |      100 |      100 |      100 |                |
  IBaseCompartment.sol                                   |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\interfaces\compartments\staking\ |      100 |      100 |      100 |      100 |                |
  IStakingHelper.sol                                     |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\interfaces\oracles\              |      100 |      100 |      100 |      100 |                |
  IOlympus.sol                                           |      100 |      100 |      100 |      100 |                |
  IUniV2.sol                                             |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\interfaces\oracles\chainlink\    |      100 |      100 |      100 |      100 |                |
  AggregatorV3Interface.sol                              |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\interfaces\wrappers\ERC20\       |      100 |      100 |      100 |      100 |                |
  IERC20Wrapper.sol                                      |      100 |      100 |      100 |      100 |                |
  IWrappedERC20Impl.sol                                  |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\interfaces\wrappers\ERC721\      |      100 |      100 |      100 |      100 |                |
  IERC721Wrapper.sol                                     |      100 |      100 |      100 |      100 |                |
  IWrappedERC721Impl.sol                                 |      100 |      100 |      100 |      100 |                |
 contracts\peer-to-peer\oracles\chainlink\               |      100 |    73.91 |      100 |    94.44 |                |
  ChainlinkBasic.sol                                     |      100 |    61.54 |      100 |    93.75 |          43,97 |
  ChainlinkBasicWithWbtc.sol                             |      100 |       75 |      100 |     87.5 |             43 |
  OlympusOracle.sol                                      |      100 |      100 |      100 |      100 |                |
  UniV2Chainlink.sol                                     |      100 |    91.67 |      100 |    95.83 |             88 |
 contracts\peer-to-peer\wrappers\ERC20\                  |      100 |    83.33 |      100 |    97.96 |                |
  ERC20Wrapper.sol                                       |      100 |     87.5 |      100 |    96.43 |             50 |
  WrappedERC20Impl.sol                                   |      100 |       75 |      100 |      100 |                |
 contracts\peer-to-peer\wrappers\ERC721\                 |      100 |    90.91 |      100 |    98.28 |                |
  ERC721Wrapper.sol                                      |      100 |    93.75 |      100 |      100 |                |
  WrappedERC721Impl.sol                                  |      100 |    83.33 |      100 |    95.65 |             61 |
 contracts\peer-to-pool\                                 |    97.66 |    88.46 |      100 |    96.61 |                |
  DataTypesPeerToPool.sol                                |      100 |      100 |      100 |      100 |                |
  Factory.sol                                            |    94.74 |    71.88 |      100 |    91.23 |... 179,195,196 |
  FundingPoolImpl.sol                                    |    95.74 |    89.13 |      100 |    97.37 |         53,124 |
  LoanProposalImpl.sol                                   |    99.22 |    92.31 |      100 |    97.74 |... 224,254,402 |
 contracts\peer-to-pool\interfaces\                      |      100 |      100 |      100 |      100 |                |
  IFactory.sol                                           |      100 |      100 |      100 |      100 |                |
  IFundingPoolImpl.sol                                   |      100 |      100 |      100 |      100 |                |
  ILoanProposalImpl.sol                                  |      100 |      100 |      100 |      100 |                |
 contracts\test\                                         |       80 |       50 |    73.33 |    89.29 |                |
  IPAXG.sol                                              |      100 |      100 |      100 |      100 |                |
  IUSDC.sol                                              |      100 |      100 |      100 |      100 |                |
  IWETH.sol                                              |      100 |      100 |      100 |      100 |                |
  MyERC20.sol                                            |      100 |      100 |      100 |      100 |                |
  MyERC721.sol                                           |      100 |       50 |      100 |      100 |                |
  MyMaliciousCallback1.sol                               |      100 |       50 |    66.67 |      100 |                |
  MyMaliciousCallback2.sol                               |      100 |       50 |    66.67 |      100 |                |
  MyMaliciousERC20.sol                                   |     62.5 |       50 |       50 |       75 |       28,46,50 |
---------------------------------------------------------|----------|----------|----------|----------|----------------|
All files                                                |    98.65 |    89.97 |    97.63 |    96.98 |                |
---------------------------------------------------------|----------|----------|----------|----------|----------------|
```
