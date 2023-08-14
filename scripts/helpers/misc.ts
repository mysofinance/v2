const { Console } = require('console')

const fs = require('fs')
const path = require('path')

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

export class Logger {
  logger: any

  constructor(dir: any, scriptName: string) {
    const currDate = new Date()
    const timestamp = `${currDate
      .toJSON()
      .slice(0, 10)}_${currDate.getHours()}-${currDate.getMinutes()}-${currDate.getSeconds()}`
    const logFileNameWithPath = path.join(dir, `logs/${timestamp}_log-run_${scriptName}.txt`)
    this.logger = new Console({
      stdout: fs.createWriteStream(logFileNameWithPath)
    })
  }

  log(logMsg: string, ...rest: any) {
    console.log(formatConsoleDate(logMsg, rest))
    this.logger.log(formatConsoleDate(logMsg, rest))
  }
}

export function loadConfig(dir: any, fname: string) {
  let jsonDeployConfig
  try {
    const jsonString = fs.readFileSync(path.join(dir, fname), 'utf-8')
    jsonDeployConfig = JSON.parse(jsonString)
  } catch (err) {
    console.error(err)
  }
  return jsonDeployConfig
}

export function saveDeployedContracts(deployedContracts: any, dir: any, scriptName: string) {
  const currDate = new Date()
  const timestamp = `${currDate
    .toJSON()
    .slice(0, 10)}_${currDate.getHours()}-${currDate.getMinutes()}-${currDate.getSeconds()}`
  const jsonFileNameWithPath = path.join(dir, `${timestamp}_${scriptName}_saved-contract-addresses.json`)
  fs.writeFile(jsonFileNameWithPath, JSON.stringify(deployedContracts), (err: any) => {
    if (err) {
      console.error(err)
      return
    }
  })
}
