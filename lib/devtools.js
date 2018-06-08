import CDP from 'chrome-remote-interface'
const fs = require('fs')
const path = require('path')

export default class DevToolsService {
    beforeSession (_, caps) {
        if (caps.browserName !== 'chrome' || (caps.version && caps.version < 63)) {
            console.error('The wdio-devtools-service currently only supports Chrome version 63 and up')
        }
    }

    async before () {
        this.chromePort = await this._findChromePort()
        this.client = await this._getCDPClient(this.chromePort)

        /**
         * allow to easily access the CDP from the browser object
         */
        browser.addCommand('cdp', (domain, command, args = {}) => {
            if (!this.client[domain]) {
                throw new Error(`Domain "${domain}" doesn't exist in the Chrome DevTools protocol`)
            }

            if (!this.client[domain][command]) {
                throw new Error(`The "${domain}" domain doesn't have a method called "${command}"`)
            }

            return new Promise((resolve, reject) => this.client[domain][command](args, (err, result) => {
                if (err) {
                    return reject(new Error(`Chrome DevTools Error: ${result.message}`))
                }

                return resolve(result)
            }))
        })

        /**
         * helper method to receive Chrome remote debugging connection data to
         * e.g. use external tools like lighthouse
         */
        const { host, port } = this.client
        browser.addCommand('cdpConnection', () => ({ host, port }))

        /**
         * propagate CDP events to the browser event listener
         */
        this.client.on('event', (event) => browser.emit(event.method || 'event', event.params))
    }

    async _findChromePort () {
        try {
            await browser.url('chrome://version')

            let chromeCommandLine = await browser.getText('#command_line')
            let indexOfUDD = chromeCommandLine.indexOf('--user-data-dir=') + 16
            let chromeUserDir = chromeCommandLine.substring(
                indexOfUDD,
                chromeCommandLine.indexOf(' --', indexOfUDD)
            ).replace(/^"(.*)"$/imu, '$1') //** * trim quotes for Windows */

            let devToolsFilePath = path.join(chromeUserDir, '/DevToolsActivePort')

            let isDevToolsFileExist = fs.existsSync(devToolsFilePath)
            if (isDevToolsFileExist == false) {
                /**
                * deprecated method for old chromedriver 
                * https://chromium-review.googlesource.com/c/chromium/src/+/994378
                */
                return browser.getText('#command_line').then((args) => parseInt(args.match(/--remote-debugging-port=(\d*)/)[1]))
            } else {
                /**
                * new method for chromedriver >= 2.39
                */
                let devToolsFile = fs.readFileSync(devToolsFilePath, 'utf8')
                let debugPort = devToolsFile.match(/(\d*)/)
                return parseInt(debugPort)
            }

            throw new Error(`Can't extract debug port`)
        } catch (err) {
            console.log(err)
            console.log(`Could'nt connect to chrome`)
        }
    }

    async _getCDPClient (port) {
        return new Promise((resolve) => CDP({
            port,
            host: 'localhost',
            target: (targets) => targets.findIndex((t) => t.type === 'page')
        }, resolve))
    }
}
