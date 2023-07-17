const { Console } = require('console')

const fs = require('fs')
const path = require('path')
const currDate = new Date()
export const fileName = `script-run-${currDate
  .toJSON()
  .slice(0, 10)}-${currDate.getHours()}-${currDate.getMinutes()}-${currDate.getSeconds()}`
export const logFileNameWithPathP2P = path.join(__dirname, `../peer-to-peer/logs/log-${fileName}.txt`)
const logger = new Console({
  stdout: fs.createWriteStream(logFileNameWithPathP2P)
})

function formatConsoleDate(logMsg: string, ...rest: any) {
  const currDate = new Date()
  const hour = currDate.getHours()
  const minutes = currDate.getMinutes()
  const seconds = currDate.getSeconds()
  const milliseconds = currDate.getMilliseconds()
  const timestampPrefix =
    '[' +
    (hour < 10 ? '0' + hour : hour) +
    ':' +
    (minutes < 10 ? '0' + minutes : minutes) +
    ':' +
    (seconds < 10 ? '0' + seconds : seconds) +
    '.' +
    ('00' + milliseconds).slice(-3) +
    '] '
  return timestampPrefix.concat(logMsg).concat(rest)
}

export function log(logMsg: string, ...rest: any) {
  console.log(formatConsoleDate(logMsg, rest))
  logger.log(formatConsoleDate(logMsg, rest))
}

function loadConfig(fname: string) {
  let jsonDeployConfig
  try {
    const jsonString = fs.readFileSync(path.join(__dirname, `../peer-to-peer/configs/${fname}.json`), 'utf-8')
    jsonDeployConfig = JSON.parse(jsonString)
  } catch (err) {
    console.error(err)
  }
  return jsonDeployConfig
}

export function loadP2PDeployConfig() {
  return loadConfig('deployConfig')
}

export function loadP2PAddOnChainQuoteConfig() {
  return loadConfig('addOnChainQuoteConfig')
}

export function loadP2PCreateVaultConfig() {
  return loadConfig('createVaultConfig')
}

export function saveP2PDeployedContracts(deployedContracts: any) {
  log(`Save deployed contracts to ${path.join(__dirname, `../peer-to-peer/output/contract-addrs-${fileName}.json`)}.`)
  fs.writeFile(
    path.join(__dirname, `../peer-to-peer/output/contract-addrs-${fileName}.json`),
    JSON.stringify(deployedContracts),
    (err: any) => {
      if (err) {
        console.error(err)
        return
      }
    }
  )
}
