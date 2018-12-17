import CDP from 'chrome-remote-interface'
import fs from 'fs'
import path from 'path'

const RE_DEVTOOLS_DEBUGGING_PORT_SWITCH = /--remote-debugging-port=(\d*)/
const RE_USER_DATA_DIR_SWITCH = /--user-data-dir=([^-]*)/

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

    /**
     * Find Chrome DevTools Interface port by checking Chrome switches from the chrome://version
     * page. In case a newer version is used (+v65) we check the DevToolsActivePort file
     */
    async _findChromePort () {
        try {
            await browser.url('chrome://version')
            const cmdLineText = await browser.getText('#command_line')
            let port = parseInt(cmdLineText.match(RE_DEVTOOLS_DEBUGGING_PORT_SWITCH)[1])
            if (port === 0) {
                const userDataDir = cmdLineText.match(RE_USER_DATA_DIR_SWITCH)[1].trim()
                const devToolsActivePortFile = fs.readFileSync(path.join(userDataDir, 'DevToolsActivePort'), 'utf8')
                port = parseInt(devToolsActivePortFile.split('\n').shift(), 10)
            }

            return port
        } catch (err) {
            console.log(`Could not connect to chrome`)
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
